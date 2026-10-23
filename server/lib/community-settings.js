/* Community settings schema (v2.56.0). `communities.settings` stays one JSON column (no schema change), but every key is
 * now declared: its section, the permission needed to change it, its validator, and its visibility:
 *   public   — safe for anyone who can see the community (feeds the public toClient allow-list)
 *   viewer   — shown on the community page to signed-in people who may join (join questions, welcome)
 *   staff    — moderators and up only (automod word lists, publicModLog …) — NEVER in public responses
 * Writes go through mutate(): read-merge-write inside ONE transaction with a row lock on PostgreSQL
 * (SELECT … FOR UPDATE), so two admins saving different sections at the same time can no longer erase each other. */
const { str, oneOf, TOPICS, E } = require("./core");
const HEX = /^#[0-9a-f]{6}$/i, GRAD = /^linear-gradient\(135deg,\s?#[0-9a-f]{3,8},\s?#[0-9a-f]{3,8}\)$/i, MEDIA = /^\/media\/[\w.-]{6,100}$/;
const slugify = (t) => String(t || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);
const bool = (v) => !!v;
/* v2.61.1: explicit «no directory category» sentinel, stored in settings.category; absent/null keeps the topic fallback */
const CAT_NONE = "none";
/** the directory category of a community: explicit choice, explicit none (null), or the topic for unset/legacy rows */
const categoryOf = (c) => { const v = c?.settings?.category; return v === CAT_NONE ? null : v || c?.topic || null; };

const AUTOMOD_DEFAULTS = { words: [], blockLinks: false, newAccountDays: 0, toxicity: "queue", action: "queue" };
/* v2.59: the legacy five fields keep their exact parsing; the automod v2 rules (`v2`) and the penalty ladder (`ladder`)
 * are added ONLY when sent — a legacy client that omits them never wipes them (keepV2), and a community that never set
 * them stores exactly the v2.58 object. */
const AR = require("./automod-rules");
const automodOf = (b = {}) => {
  const out = { words: (Array.isArray(b.words) ? b.words : []).map(w => str(String(w), 40)).filter(Boolean).slice(0, 200), blockLinks: !!b.blockLinks, newAccountDays: Math.max(0, Math.min(90, +b.newAccountDays || 0)), toxicity: oneOf(b.toxicity, ["off", "queue", "reject"], "queue"), action: oneOf(b.action, ["queue", "reject"], "queue") };
  if (b.v2 !== undefined && b.v2 !== null) out.v2 = AR.parseV2(b.v2);
  if (b.ladder !== undefined && b.ladder !== null) out.ladder = AR.parseLadder(b.ladder);
  /* v2.62 «الحارس التلقائي»: added ONLY when sent (OFF unless enabled:true); a body without it stores the exact v2.61 object */
  if (b.guard !== undefined && b.guard !== null) out.guard = AR.parseGuard(b.guard);
  return out;
};
/** carry the stored v2 rules / ladder / guard over a patch that did not send them */
const KEEP_KEYS = ["v2", "ladder", "guard"];
const keepV2 = (prev, next) => { if (!next || !prev) return next; const out = { ...next }; for (const k of KEEP_KEYS) if (out[k] === undefined && prev[k] !== undefined) out[k] = prev[k]; return out; };

/* v2.60: «مجتمع كوين» rewards a community pays from its OWNER's wallet (minor units; 1 MJT = 10,000,000). Hard bounds — a
 * community can never promise more than this, and the platform switch (mjt rewards.enabled) still applies. */
const MJT = require("./mjt-ledger");
const RW_MAX = { perPost: 5, perAnswer: 20, memberDailyCap: 50, communityDailyCap: 1000 }; // MJT
const RW_DEFAULTS = { enabled: false, perPost: 0.5 * MJT.UNIT, perAnswer: 2 * MJT.UNIT, memberDailyCap: 5 * MJT.UNIT, communityDailyCap: 50 * MJT.UNIT };
function rewardsOf(v = {}) {
  const out = { ...RW_DEFAULTS, enabled: !!v?.enabled };
  for (const k of Object.keys(RW_MAX)) {
    if (v?.[k] === undefined || v[k] === null || v[k] === "") continue;
    const u = typeof v[k] === "number" && Number.isSafeInteger(v[k]) && v[k] > 1000 ? v[k] : MJT.parseAmount(String(v[k]), { allowZero: k.startsWith("per") }); // units (stored) or "0.5" (typed)
    if (u < 0 || u > RW_MAX[k] * MJT.UNIT) throw E.bad(`القيمة خارج الحدود (الأعلى ${RW_MAX[k]} MJT)`);
    out[k] = u;
  }
  if (out.memberDailyCap > out.communityDailyCap) out.memberDailyCap = out.communityDailyCap;
  return out;
}
const rewardsClient = (r) => { const x = { ...RW_DEFAULTS, ...(r || {}) }; return { enabled: !!x.enabled, perPost: MJT.format(x.perPost), perAnswer: MJT.format(x.perAnswer), memberDailyCap: MJT.format(x.memberDailyCap), communityDailyCap: MJT.format(x.communityDailyCap), max: RW_MAX }; };

/* key → { section, vis, perm, parse } */
const FIELDS = {
  whoCanPost: { section: "general", vis: "public", perm: "edit_settings", parse: v => oneOf(v, ["members", "mods"], "members") },
  requireApproval: { section: "general", vis: "public", perm: "edit_settings", parse: bool },
  allowLinks: { section: "general", vis: "public", perm: "edit_settings", parse: bool },
  allowMedia: { section: "general", vis: "public", perm: "edit_settings", parse: bool },
  allowCommercial: { section: "general", vis: "public", perm: "edit_settings", parse: bool },
  aiModeration: { section: "general", vis: "public", perm: "edit_settings", parse: bool },
  icon: { section: "identity", vis: "public", perm: "edit_identity", parse: v => v ? [...String(v)].slice(0, 2).join("") : null },
  accent: { section: "identity", vis: "public", perm: "edit_identity", parse: v => HEX.test(v || "") ? v : null },
  cover: { section: "identity", vis: "public", perm: "edit_identity", parse: v => MEDIA.test(v || "") || GRAD.test(v || "") ? v : null },
  /* "none" (or "") = the owner explicitly chose «بدون»; null/unknown = unset → the directory falls back to the community topic (legacy) */
  category: { section: "identity", vis: "public", perm: "edit_identity", parse: v => v === "none" || v === "" ? CAT_NONE : TOPICS.some(t => t.slug === v) ? v : null },
  tags: { section: "identity", vis: "public", perm: "edit_identity", parse: v => (Array.isArray(v) ? v : []).map(t => ({ slug: slugify(t.slug || t.name), name: str(t.name, 30), color: HEX.test(t.color || "") ? t.color : "#6d3df5" })).filter(t => t.slug && t.name).slice(0, 20) },
  /* v2.62: «عضو جديد» + anniversary badges next to names in the community (ON unless false) */
  memberBadges: { section: "identity", vis: "public", perm: "edit_identity", parse: bool },
  rulesRequired: { section: "joining", vis: "public", perm: "edit_identity", parse: bool },
  joinQuestions: { section: "joining", vis: "viewer", perm: "edit_identity", parse: v => (Array.isArray(v) ? v : []).map(q => str(typeof q === "string" ? q : q?.q, 200)).filter(Boolean).slice(0, 5) },
  welcome: { section: "joining", vis: "viewer", perm: "edit_identity", parse: v => v ? { message: str(v.message, 1000) || "", steps: (Array.isArray(v.steps) ? v.steps : []).map(x => str(x, 120)).filter(Boolean).slice(0, 6) } : null },
  /* v2.58: the content types members may post in this community (empty = all); text is always allowed. A channel can narrow it. */
  contentTypes: { section: "content", vis: "public", perm: "edit_settings", parse: v => [...new Set((Array.isArray(v) ? v : []).filter(t => ["text", "image", "video", "audio", "poll", "question", "article", "event"].includes(t)))] }, // ["text"] = text only
  automod: { section: "moderation", vis: "staff", perm: "manage_automod", parse: automodOf },
  publicModLog: { section: "moderation", vis: "staff", perm: "manage_automod", parse: bool },
  /* v2.57: lockdown — posting paused (below the moderators) until this time, at most 7 days ahead; null lifts it */
  /* v2.60: member notifications default for NEW members, event reminder defaults, the community market tab, MJT rewards */
  notifyDefault: { section: "notify", vis: "staff", perm: "edit_identity", parse: v => oneOf(v, ["all", "highlights", "digest"], "all") },
  eventReminders: { section: "events", vis: "staff", perm: "edit_identity", parse: v => ({ day: v?.day !== false, hour: v?.hour !== false }) },
  marketTab: { section: "integrations", vis: "public", perm: "manage_integrations", parse: bool },
  mjtRewards: { section: "rewards", vis: "staff", perm: "edit_settings", parse: v => rewardsOf(v) },
  lockdownUntil: { section: "safety", vis: "public", perm: "manage_automod", parse: v => { const d = v ? new Date(v) : null; return d && !isNaN(+d) && +d > Date.now() ? new Date(Math.min(+d, Date.now() + 7 * 864e5)).toISOString() : null; } }
};
const SECTIONS = { content: "المحتوى", general: "عام", identity: "الهوية", joining: "الانضمام والترحيب", moderation: "الإشراف الآلي", safety: "الإيقاف المؤقت", notify: "إشعارات الأعضاء", events: "الفعاليات", integrations: "التكاملات", rewards: "مكافآت مجتمع كوين" };
const PUBLIC_KEYS = Object.keys(FIELDS).filter(k => FIELDS[k].vis === "public");

/** only the public keys of a settings bag — the rest never leaves the server in list/bootstrap responses */
function publicSettings(s) { const out = {}; for (const k of PUBLIC_KEYS) if (s && s[k] !== undefined) out[k] = s[k]; return out; }
/** parse a patch for one section; unknown keys are ignored; returns { patch } */
function parseSection(section, body) {
  if (!SECTIONS[section]) return null;
  const patch = {};
  for (const [k, f] of Object.entries(FIELDS)) if (f.section === section && body && body[k] !== undefined) patch[k] = f.parse(body[k]);
  return patch;
}
/** before → after for the changed keys only (audit diff); staff-only values are summarised, not copied */
function diff(before = {}, after = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
    out[k] = k === "automod" ? { from: summary(before[k]), to: summary(after[k]) } : { from: before[k] ?? null, to: after[k] ?? null };
  }
  return out;
}
const summary = (a) => a ? { words: (a.words || []).length, blockLinks: !!a.blockLinks, newAccountDays: a.newAccountDays || 0, toxicity: a.toxicity, action: a.action, ...(a.v2 ? { v2: Object.keys(a.v2).filter(k => a.v2[k]?.enabled) } : {}), ...(a.ladder ? { ladder: !!a.ladder.enabled } : {}), ...(a.guard ? { guard: guardSummary(a.guard) } : {}) } : null;
/** audit view of the guard: switches + counts only — the word / allow lists are never copied into the log */
const guardSummary = (g) => ({ enabled: g.enabled === true, words: (g.words || []).length, allow: (g.allow || []).length, muteHours: g.muteHours, maxStrikes: g.maxStrikes, decayDays: g.decayDays, fullLock: !!g.fullLock, liftMin: g.liftMin });

/** atomic read-merge-write of communities.settings; fn(current) → next (may also return extra column updates) */
async function mutate(db, cid, fn) {
  return db.tx(async t => {
    const c = await t.get(`SELECT * FROM communities WHERE id=$1${db.dialect === "postgres" ? " FOR UPDATE" : ""}`, [cid]);
    if (!c) return null;
    const before = { ...(c.settings || {}) };
    const next = await fn({ ...before }, c);
    await t.run("UPDATE communities SET settings=$1 WHERE id=$2", [next, cid]);
    return { before, after: next, community: { ...c, settings: next } };
  });
}
module.exports = { guardSummary, CAT_NONE, categoryOf, KEEP_KEYS, summary, rewardsOf, rewardsClient, RW_DEFAULTS, RW_MAX, keepV2, FIELDS, SECTIONS, PUBLIC_KEYS, AUTOMOD_DEFAULTS, automodOf, publicSettings, parseSection, diff, mutate, slugify, HEX, GRAD, MEDIA };
