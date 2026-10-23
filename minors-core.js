/* مجتمع بلس — Phase 35 (child safety & sensitive content): pure rules shared by the browser and the server.
 * No I/O here: age arithmetic on a self-declared birth date, the sensitive-content label taxonomy, the
 * per-viewer visibility/cover decision, the minor-account defaults and the severity heuristic used to
 * route reports into the priority (escalation) queue. server/services/minors.js and minors-ui.js both
 * load this file so the two sides can never disagree about a rule.
 *   • Age is SELF-DECLARED (no ID upload). It is a signal, not proof; see docs/MINORS-SAFETY.md.
 *   • Bands: child (< minAge, refused), teen (minAge–17, protected defaults), adult (18+), unknown. */
(function (/** @type {any} */ root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.MPMinorsCore = factory(); })(typeof self !== "undefined" ? self : this, function () {
  const ADULT_AGE = 18, DEFAULT_MIN_AGE = 13, MAX_AGE = 120;

  /* ---------- age ---------- */
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  /** "YYYY-MM-DD" → normalized string, or null when malformed / impossible / in the future / older than 120 years */
  function parseBirthDate(s, today = new Date()) {
    const m = DATE.exec(String(s || "").trim()); if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // 2026-02-30
    const age = ageOn(m[0], today);
    if (age === null || age < 0 || age > MAX_AGE || dt.getTime() > today.getTime()) return null;
    return m[0];
  }
  /** whole years between a birth date and `today` (calendar based; 29 Feb birthdays turn over on 1 Mar) */
  function ageOn(birthDate, today = new Date()) {
    const m = DATE.exec(String(birthDate || "")); if (!m) return null;
    const y = today.getUTCFullYear(), mo = today.getUTCMonth() + 1, d = today.getUTCDate();
    let a = y - +m[1];
    if (mo < +m[2] || (mo === +m[2] && d < +m[3])) a--;
    return a;
  }
  /** child | teen | adult | unknown */
  function band(age, minAge = DEFAULT_MIN_AGE) {
    if (age === null || age === undefined || Number.isNaN(age)) return "unknown";
    if (age < minAge) return "child";
    return age < ADULT_AGE ? "teen" : "adult";
  }
  const isMinor = (b) => b === "teen" || b === "child";
  /** date on which a birth date turns `years` old (ISO day) — used to tell a teen when restrictions lift */
  function birthdayAt(birthDate, years) {
    const m = DATE.exec(String(birthDate || "")); if (!m) return null;
    const dt = new Date(Date.UTC(+m[1] + years, +m[2] - 1, +m[3]));
    // Date.UTC rolls 29 Feb over to 1 Mar in common years, matching ageOn()
    return dt.toISOString().slice(0, 10);
  }

  /* ---------- sensitive-content labels (set by the publisher, a moderator, or the legacy keyword classifier) ---------- */
  /* adultOnly: never shown to minors nor to viewers of unknown age; every label except spoiler is hidden from minors */
  const LABELS = {
    violence: { name: "عنف", hint: "مشاهد أو أوصاف عنيفة", adultOnly: false },
    graphic: { name: "مشاهد صادمة", hint: "دماء أو إصابات أو مشاهد مزعجة", adultOnly: true },
    adult: { name: "للبالغين", hint: "إيحاءات أو محتوى لا يناسب من هم دون ١٨", adultOnly: true },
    self_harm: { name: "إيذاء النفس", hint: "حديث عن إيذاء النفس أو الانتحار", adultOnly: false, support: true },
    gambling: { name: "مقامرة", hint: "رهانات أو ألعاب حظ بمال", adultOnly: true },
    medical: { name: "طبي", hint: "صور أو تفاصيل طبية", adultOnly: false },
    spoiler: { name: "حرق أحداث", hint: "يكشف أحداث عمل فني أو مباراة", adultOnly: false, mild: true }
  };
  const LABEL_KEYS = Object.keys(LABELS);
  /** user input → unique known labels (max 4), stable order */
  function normalizeLabels(input) {
    const arr = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
    const set = new Set(arr.map(x => String(x || "").trim().toLowerCase()));
    return LABEL_KEYS.filter(k => set.has(k)).slice(0, 4);
  }
  /** media labels: { "0": [...], "3": [...] } → same shape, cleaned, indexes 0–9 only */
  function normalizeMediaLabels(input) {
    const out = {}; if (!input || typeof input !== "object") return out;
    for (const [k, v] of Object.entries(input)) { const i = +k; if (Number.isInteger(i) && i >= 0 && i < 10) { const l = normalizeLabels(v); if (l.length) out[i] = l; } }
    return out;
  }
  const allLabels = (l) => { const s = new Set(l?.post || []); for (const v of Object.values(l?.media || {})) for (const x of v) s.add(x); return [...s]; };

  /** viewer: { band, pref: blur|show|hide, staff } ; post: { labels:{post,media}, sensitive, own }
   *  → "show" | "cover" | "hide". Minors never see restricted content; unknown age never sees adult-only. */
  function decide(viewer, post) {
    if (post.own) return "show";
    const labels = allLabels(post.labels);
    if (post.sensitive && !labels.length) labels.push("_legacy"); // keyword-classified or the old «محتوى حساس» checkbox
    if (!labels.length) return "show";
    const restricted = labels.filter(l => !LABELS[l]?.mild);
    const b = viewer?.band || "unknown";
    if (isMinor(b) && restricted.length) return "hide";
    if (b === "unknown" && labels.some(l => LABELS[l]?.adultOnly)) return "hide";
    const pref = viewer?.pref || "blur";
    if (pref === "hide" && restricted.length) return "hide";
    if (pref === "show" && b === "adult") return "show";
    return "cover";
  }

  /* ---------- defaults for minor accounts ---------- */
  const MINOR_PRIVACY = { dm: "following", mentions: "following", filterRequests: true };
  const MINOR_DEFAULTS = { private: true, privacy: MINOR_PRIVACY, location: false, sensitive: "hide", discoverable: false };
  const STRICT = { everyone: 0, following: 1, nobody: 2 };
  /** the strictest of two interaction settings */
  const stricter = (a, b) => ((STRICT[a] ?? 0) >= (STRICT[b] ?? 0) ? a : b);
  /** may a minor set `key` to `value` given the floor (minor defaults merged with guardian controls)? */
  function allowedForMinor(key, value, floor) { const f = floor?.[key]; if (!f || STRICT[value] === undefined) return true; return STRICT[value] >= STRICT[f]; }
  /* guardian controls: limited on purpose and only able to tighten */
  const GUARDIAN_CONTROLS = {
    dm: { name: "من يراسله", values: ["following", "nobody"] },
    comments: { name: "من يعلّق على منشوراته", values: ["everyone", "following", "nobody"] },
    mentions: { name: "من يشير إليه", values: ["following", "nobody"] }
  };
  function normalizeControls(input) {
    const out = {}; if (!input || typeof input !== "object") return out;
    for (const [k, def] of Object.entries(GUARDIAN_CONTROLS)) if (def.values.includes(input[k])) out[k] = input[k];
    return out;
  }

  /* ---------- escalation (severity heuristic; staff confirm every case) ---------- */
  const norm = (t) => String(t || "").toLowerCase().replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  const CRITICAL = ["استغلال جنسي", "استغلال الاطفال", "استغلال طفل", "اعتداء جنسي", "اساءه جنسيه", "ابتزاز جنسي", "استدراج", "صور عاريه لطفل", "صور فاضحه لقاصر", "تحرش بطفل", "تحرش بقاصر", "csam", "child abuse", "child sexual", "grooming", "sextortion"];
  const HIGH = ["انتحار", "ينتحر", "اقتل نفسي", "ايذاء النفس", "اذيه نفسي", "تهديد بالقتل", "سيقتل", "ابتزاز", "تحرش", "طفل في خطر", "قاصر في خطر", "اختطاف", "تهريب بشر", "suicide", "self-harm", "self harm", "kill myself", "threat to kill", "trafficking", "kidnap"];
  const CATEGORIES = { child_safety: "سلامة طفل", self_harm: "إيذاء النفس", violent_threat: "تهديد بالعنف", exploitation: "استغلال أو ابتزاز", trafficking: "اتجار بالبشر", other: "أخرى" };
  const SEV = { critical: 3, high: 2, normal: 1 };
  /** text (+ facts) → { severity, category, reasons }  — a heuristic to order the queue, never an automatic verdict
   * @param {string} text @param {{ category?: string|null, minorInvolved?: boolean }} [opts] */
  function classifySeverity(text, { category = null, minorInvolved = false } = {}) {
    const t = norm(text), reasons = [];
    const hit = (list) => list.filter(w => { const n = norm(w); return n.length <= 3 ? new RegExp(`(^|[^a-z])${n}([^a-z]|$)`).test(t) : t.includes(n); });
    const crit = hit(CRITICAL), high = hit(HIGH);
    let severity = "normal", cat = CATEGORIES[category] ? category : null;
    if (crit.length) { severity = "critical"; reasons.push(...crit); cat ||= "child_safety"; }
    else if (high.length) { severity = "high"; reasons.push(...high); cat ||= /انتحار|ينتحر|نفسي|نفس|suicide|self|myself/.test(high.join(" ")) ? "self_harm" : /اتجار|تهريب|traffick|اختطاف|kidnap/.test(high.join(" ")) ? "trafficking" : /ابتزاز/.test(high.join(" ")) ? "exploitation" : "violent_threat"; }
    if (cat === "child_safety" || cat === "exploitation" || cat === "trafficking") severity = SEV[severity] >= SEV.high ? "critical" : "high";
    if (cat === "self_harm" && severity === "normal") severity = "high";
    if (minorInvolved) { reasons.push("minor_involved"); severity = severity === "normal" ? "high" : "critical"; }
    return { severity, category: cat || "other", reasons: [...new Set(reasons)] };
  }
  /** queue priority: higher first. severity dominates, then age of the case (older first, capped) */
  function priority(severity, createdAt, now = Date.now()) {
    const ageH = Math.max(0, (now - new Date(createdAt).getTime()) / 3600e3);
    return (SEV[severity] || 1) * 1000 + Math.min(Math.floor(ageH), 999);
  }
  /** SLA target per severity (minutes) */
  const SLA_MIN = { critical: 60, high: 240, normal: 1440 };

  return { ADULT_AGE, DEFAULT_MIN_AGE, parseBirthDate, ageOn, band, isMinor, birthdayAt, LABELS, LABEL_KEYS, normalizeLabels, normalizeMediaLabels, allLabels, decide,
    MINOR_DEFAULTS, MINOR_PRIVACY, STRICT, stricter, allowedForMinor, GUARDIAN_CONTROLS, normalizeControls, CATEGORIES, SEV, classifySeverity, priority, SLA_MIN, norm };
});
