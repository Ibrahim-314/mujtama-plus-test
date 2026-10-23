/* مجتمع بلس — User protection core (Track 7, phase 33). One zero-dependency module shared by the
 * browser (window.MPProtection) and the server (require("../../protection-core.js")):
 *   • normalize()/muteHit(): Arabic-aware mute matching (tashkeel, hamza forms, ة/ه, ى/ي, digits),
 *     whole-word mode with the common Arabic proclitics (و ف ب ل ك ال وال بال …), hashtags and expiry
 *   • canReply(): who may reply to a post (everyone | followers | mentioned | community)
 *   • trustedDuringProtection(): who still gets through while protection mode is on
 *   • detectWave(): transparent abuse-wave heuristic used to *suggest* protection mode
 *   • REPORT: the 3-step report taxonomy (what happened → details → protect yourself)
 *   • DURATIONS / expiry helpers for timed mutes and protection windows */
(function (/** @type {any} */ root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.MPProtectionCore = factory(); })(typeof self !== "undefined" ? self : this, function () {
  const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
  const DIGITS = "٠١٢٣٤٥٦٧٨٩", PDIGITS = "۰۱۲۳۴۵۶۷۸۹";
  /** @param {any} s */
  function normalize(s) {
    if (s === null || s === undefined) return "";
    return String(s).normalize("NFKC").replace(TASHKEEL, "").replace(/\u0640/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ء/g, "").replace(/ة/g, "ه").replace(/ى/g, "ي")
      .replace(/[٠-٩]/g, d => String(DIGITS.indexOf(d))).replace(/[۰-۹]/g, d => String(PDIGITS.indexOf(d)))
      .toLowerCase().replace(/(.)\1{2,}/gu, "$1$1").replace(/[^\p{L}\p{N}_#@\s]+/gu, " ").replace(/\s+/g, " ").trim();
  }
  /* optional conjunction (و/ف) then optional preposition/article: وبالإساءة، فللـ، كال… */
  const PROCLITIC_RE = "(?:[وف])?(?:بال|كال|وال|فال|لل|ال|ب|ل|ك)?";
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* ---------- timed, scoped mutes ---------- */
  const SCOPES = ["all", "feed", "notifications", "replies"];
  const KINDS = ["word", "hashtag", "user"];
  const DURATIONS = { "1h": 3600e3, "1d": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5, forever: 0 };
  const DURATION_LABELS = { "1h": "ساعة", "1d": "يوم", "7d": "أسبوع", "30d": "شهر", forever: "دائماً" };
  /** @param {string} d @param {number} [at] @returns {string|null} ISO expiry, or null for "forever" */
  function expiryFor(d, at = Date.now()) { const ms = DURATIONS[d]; return ms ? new Date(at + ms).toISOString() : null; }
  /** @param {{ expiresAt?: string|null, expires_at?: string|null }} r @param {number} [at] */
  const active = (r, at = Date.now()) => { const e = r.expiresAt ?? r.expires_at; return !e || new Date(e).getTime() > at; };
  /** a rule applies in `scope` when it is "all" or the same scope */
  const inScope = (r, scope) => !scope || !r.scope || r.scope === "all" || r.scope === scope;
  /** @param {string} text @param {string} word @param {boolean} [whole] */
  function wordHit(text, word, whole) {
    const t = normalize(text), w = normalize(word).replace(/^#/, "");
    if (!t || !w) return false;
    if (!whole) return t.includes(w);
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])[#@]?${PROCLITIC_RE}${esc(w)}(?=$|[^\\p{L}\\p{N}_])`, "u");
    return re.test(t);
  }
  /** hashtags present in a text, normalised without "#" */
  const hashtags = (text) => [...new Set((String(text || "").match(/#[\p{L}\p{N}_]+/gu) || []).map(h => normalize(h.slice(1)).replace(/^ال/, "")))];
  /**
   * Does any active rule mute this item?
   * @param {{ text?: string, author?: string }} item
   * @param {Array<{kind:string, value:string, scope?:string, wholeWord?:boolean, whole_word?:any, expiresAt?:string|null, expires_at?:string|null}>} rules
   * @param {string} [scope] feed | notifications | replies
   * @returns {null | { kind: string, value: string }}
   */
  function muteHit(item, rules, scope, at = Date.now()) {
    if (!rules || !rules.length || !item) return null;
    const tags = item.text ? hashtags(item.text) : [];
    for (const r of rules) {
      if (!r || !active(r, at) || !inScope(r, scope)) continue;
      if (r.kind === "user") { if (item.author && item.author === r.value) return { kind: r.kind, value: r.value }; continue; }
      if (!item.text) continue;
      if (r.kind === "hashtag") { const v = normalize(String(r.value).replace(/^#/, "")).replace(/^ال/, ""); if (tags.includes(v)) return { kind: r.kind, value: r.value }; continue; }
      if (wordHit(item.text, r.value, !!(r.wholeWord ?? r.whole_word))) return { kind: r.kind, value: r.value };
    }
    return null;
  }

  /* ---------- who may reply ---------- */
  const AUDIENCES = ["everyone", "followers", "mentioned", "community"];
  const AUDIENCE_LABELS = { everyone: "الجميع", followers: "متابعوك فقط", mentioned: "من أشرت إليهم فقط", community: "أعضاء المجتمع فقط" };
  /**
   * @param {{ audience?: string, actor: string, author: string, followsAuthor?: boolean, authorFollows?: boolean, mentioned?: boolean, member?: boolean, hasCommunity?: boolean }} f
   * followers = accounts that follow the author (plus accounts the author follows, so a conversation partner is never locked out)
   */
  function canReply(f) {
    if (!f || f.actor === f.author) return true;
    const a = AUDIENCES.includes(f.audience) ? f.audience : "everyone";
    if (a === "everyone") return true;
    if (f.mentioned) return true; // anyone the author tagged may always answer
    if (a === "followers") return !!(f.followsAuthor || f.authorFollows);
    if (a === "community") return f.hasCommunity ? !!f.member : !!(f.followsAuthor || f.authorFollows);
    return false; // mentioned-only
  }

  /* ---------- protection mode ---------- */
  const LIMITS = ["replies", "dms", "mentions"];
  const MODE_HOURS = [1, 6, 12, 24, 72, 168];
  /**
   * While protection mode is on, only these get through: accounts the owner follows, and accounts that
   * followed the owner *before* the mode started (a wave of brand-new followers does not count).
   * @param {{ ownerFollows?: boolean, followedAt?: string|null, startedAt?: string|null }} f
   */
  function trustedDuringProtection(f) {
    if (f.ownerFollows) return true;
    if (!f.followedAt) return false;
    if (!f.startedAt) return true;
    return new Date(f.followedAt).getTime() < new Date(f.startedAt).getTime();
  }
  /** limit key for a policy rule key */
  const limitFor = (key) => ({ comments: "replies", dm: "dms", mentions: "mentions" })[key] || null;

  /* ---------- abuse-wave heuristic (suggestion only, never a sanction) ---------- */
  const WAVE = { windowMs: 3600e3, minEvents: 15, minStrangers: 8, minToxicActors: 4, toxicAt: 0.5 };
  /**
   * @param {Array<{ at: number, actor: string, stranger?: boolean, toxic?: number }>} events incoming interactions for one person
   * @param {Partial<typeof WAVE>} [cfg]
   */
  function detectWave(events, cfg = {}, at = Date.now()) {
    const c = { ...WAVE, ...cfg };
    const recent = (events || []).filter(e => at - e.at <= c.windowMs);
    const actors = new Set(recent.map(e => e.actor));
    const strangers = new Set(recent.filter(e => e.stranger).map(e => e.actor));
    const toxicActors = new Set(recent.filter(e => (e.toxic || 0) >= c.toxicAt).map(e => e.actor));
    const reasons = [];
    if (recent.length >= c.minEvents && strangers.size >= c.minStrangers) reasons.push("strangers");
    if (toxicActors.size >= c.minToxicActors) reasons.push("toxic");
    const score = Math.min(1, Math.round((strangers.size / (c.minStrangers * 2) + toxicActors.size / (c.minToxicActors * 2)) * 100) / 100);
    return { wave: reasons.length > 0, reasons, events: recent.length, actors: actors.size, strangers: strangers.size, toxicActors: toxicActors.size, score };
  }

  /* ---------- 3-step report taxonomy ---------- */
  /** step 1 categories → step 2 sub-reasons; `urgent` raises queue priority; `help` shows support resources */
  const REPORT = [
    { key: "harassment", label: "إساءة أو تنمّر", hint: "إهانات، تحرش، استهداف متكرر", subs: [["me", "موجّه إليّ"], ["other", "موجّه لشخص آخر"], ["threat", "تهديد بالأذى", 1], ["doxxing", "نشر معلومات شخصية خاصة", 1], ["pile_on", "هجوم جماعي منسّق"]] },
    { key: "hate", label: "كراهية أو تمييز", hint: "بسبب الأصل أو الدين أو الجنس أو الإعاقة", subs: [["speech", "خطاب كراهية"], ["incite", "تحريض على العنف", 1], ["symbols", "رموز أو شعارات كراهية"]] },
    { key: "self_harm", label: "إيذاء النفس", hint: "شخص قد يكون في خطر", help: 1, subs: [["risk", "شخص قد يؤذي نفسه الآن", 1], ["content", "محتوى يشجع على إيذاء النفس", 1], ["eating", "اضطرابات الأكل"]] },
    { key: "violence", label: "عنف أو محتوى صادم", hint: "صور دموية، تمجيد العنف", subs: [["graphic", "مشاهد صادمة"], ["glorify", "تمجيد العنف أو الإرهاب", 1], ["animal", "إيذاء الحيوانات"]] },
    { key: "sexual", label: "محتوى جنسي أو استغلال", hint: "محتوى غير لائق أو استغلال", subs: [["adult", "محتوى جنسي"], ["minor", "استغلال قاصرين", 1], ["nonconsent", "صور خاصة دون موافقة", 1], ["extortion", "ابتزاز", 1]] },
    { key: "spam", label: "محتوى مزعج أو احتيال", hint: "إعلانات متكررة، روابط مشبوهة", subs: [["ads", "إعلانات متكررة"], ["scam", "احتيال أو نصب مالي"], ["phishing", "روابط تصيّد"], ["fake", "حساب وهمي أو آلي"]] },
    { key: "misinfo", label: "معلومات مضللة", hint: "معلومات كاذبة قد تسبب ضرراً", subs: [["health", "معلومات صحية مضللة"], ["civic", "تضليل حول الشأن العام"], ["manipulated", "صور أو مقاطع مفبركة"]] },
    { key: "impersonation", label: "انتحال شخصية", hint: "يتظاهر بأنه شخص أو جهة أخرى", subs: [["me", "ينتحل شخصيتي"], ["someone", "ينتحل شخصية شخص أعرفه"], ["brand", "ينتحل شخصية جهة أو مؤسسة"]] },
    { key: "ip", label: "حقوق ملكية", hint: "استخدام عملك دون إذن", subs: [["copyright", "حقوق نشر"], ["trademark", "علامة تجارية"]] },
    { key: "other", label: "شيء آخر", hint: "لا يناسب الخيارات السابقة", subs: [["other", "أخرى"]] }
  ];
  const REPORT_KINDS = ["post", "comment", "user", "community", "message"];
  /** @param {string} cat @param {string} [sub] */
  function reportReason(cat, sub) {
    const c = REPORT.find(x => x.key === cat); if (!c) return null;
    const s = c.subs.find(x => x[0] === sub) || c.subs[0];
    return { category: c.key, subcategory: s[0], reason: `${c.label} — ${s[1]}`.slice(0, 200), urgent: !!(s[2] || 0), help: !!c.help, priority: s[2] ? 2 : c.help ? 1 : 0 };
  }

  return { normalize, wordHit, hashtags, muteHit, active, inScope, expiryFor, SCOPES, KINDS, DURATIONS, DURATION_LABELS,
    AUDIENCES, AUDIENCE_LABELS, canReply, LIMITS, MODE_HOURS, trustedDuringProtection, limitFor, WAVE, detectWave,
    REPORT, REPORT_KINDS, reportReason };
});
