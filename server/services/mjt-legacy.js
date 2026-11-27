/* v2.163 → v2.167 — the LEGACY MJT paths (the ones that predate the phase-4 reward engine).
 * v2.167 «التطبيق يشتغل تلقائياً»: the admin switches and the MJT_LEGACY_<PATH> env overrides are gone. Every path is fixed ON
 * in server/config/app-defaults.js (mjt.legacy) — the owner's rule is that no member feature is hidden or switched off.
 * Mining and the daily sign-in reward are now counted inside the overall earning caps and pass the identity checks
 * (services/mining.js + services/mjt-safety.js). The old 'legacy' row in mjt_settings is left in the database and not read.
 *
 *   path              what it covers
 *   transfers         POST /api/mjt/transfers (member → member, under the identity checks of services/mjt-safety.js)
 *   tips              POST /api/mjt/posts/:id/tips and /api/mjt/rooms/:id/tips
 *   mining            POST /api/mjt/mining/start (24-hour session, inside the overall caps)
 *   checkin           POST /api/mjt/checkin (+1 MJT daily sign-in, inside the overall caps)
 *   conversion        the one-time points → MJT batch conversion at boot
 *   pointRewards      minting MJT for each new contribution-points award
 *   ownerGrant        the MJT_OWNER_GRANT boot grant
 *   communityRewards  community owner-funded MJT rewards
 *   buy               /api/mjt/buy — always 501 (unchanged, not part of this module's switches) */
const { HttpError } = require("../lib/core");
const DEF = require("../config/app-defaults");

const PATHS = [
  { key: "transfers", ar: "التحويل بين الأعضاء", en: "Member transfers", subs: ["member_transfer|transfer"] },
  { key: "tips", ar: "إكراميات MJT على المنشورات والبث المباشر", en: "MJT tips on posts and live rooms", subs: ["tip|tip"] },
  { key: "mining", ar: "التعدين اليومي", en: "Daily mining", subs: ["legacy_issuance|mining"] },
  { key: "checkin", ar: "مكافأة الدخول اليومي", en: "Daily sign-in reward", subs: ["legacy_issuance|checkin"] },
  { key: "conversion", ar: "تحويل نقاط المساهمة إلى MJT (دفعة التحويل)", en: "Points → MJT conversion (batch)", subs: ["legacy_issuance|points_conversion", "legacy_issuance|points_conversion_reversal"] },
  { key: "pointRewards", ar: "مكافآت MJT على نقاط المساهمة الجديدة", en: "MJT for new contribution points", subs: ["legacy_issuance|points_reward", "legacy_issuance|points_reward_clawback"] },
  { key: "ownerGrant", ar: "رصيد تجربة المالك (MJT_OWNER_GRANT)", en: "Owner test grant (MJT_OWNER_GRANT)", subs: ["legacy_issuance|owner_grant", "legacy_issuance|owner_grant_undo"] },
  { key: "communityRewards", ar: "مكافآت المجتمعات بـ MJT", en: "Community MJT rewards", subs: ["member_transfer|community_reward", "member_transfer|community_reward_reversal"] }
];
const FIXED = [{ key: "buy", ar: "شراء MJT بـ Pi", en: "Buy MJT with Pi", subs: ["legacy_issuance|pi_buy"], fixed: true }];
const KEYS = PATHS.map((p) => p.key);
const MEMBER_KEYS = ["transfers", "tips", "mining", "checkin"]; // the flags a member's UI reads
const CODE = "mjt_legacy_disabled";

/** @param {any} _ctx */
module.exports = (_ctx) => {
  const on = (key) => DEF.mjt.legacy[key] !== false;
  async function isOn(key) { return KEYS.includes(key) ? on(key) : false; }
  async function flags(keys = KEYS) { const out = {}; for (const k of keys) out[k] = await isOn(k); return out; }
  const label = (key) => PATHS.find((p) => p.key === key) || { ar: key, en: key };
  const note = (key) => `«${label(key).ar}» غير متاح`;
  function error(key) { return Object.assign(new HttpError(409, note(key), CODE), { details: { path: key, messageEn: `${label(key).en} is not available` } }); }
  async function guard(key) { if (!(await isOn(key))) throw error(key); }
  async function state() { return { paths: PATHS.map((p) => ({ key: p.key, label: p.ar, labelEn: p.en, subs: p.subs, stored: on(p.key), enabled: on(p.key) })), fixed: FIXED.map((p) => ({ key: p.key, label: p.ar, labelEn: p.en, subs: p.subs, enabled: false, fixed: true })), updatedAt: null, note: "كل المسارات تعمل تلقائياً — لا مفاتيح إدارية (v2.167)." }; }
  return { PATHS, FIXED, KEYS, MEMBER_KEYS, CODE, isOn, flags, guard, error, note, state, invalidate: () => {} };
};
module.exports.PATHS = PATHS;
module.exports.FIXED = FIXED;
