/* v2.167 — «التطبيق يشتغل تلقائياً»: the ONE place every former admin setting is read from.
 *
 * Owner rule (2026-11-27): nothing a member has today is hidden or removed. Every feature and service is ON and works by itself,
 * with no admin switching, pricing, approving or reviewing anything. A value here changes only through a pull request.
 * Old rows in mjt_settings / membership_meta / feature_flags are left in the database untouched (no data is deleted) but are no
 * longer read: the code below wins.
 *
 * Environment overrides (only these two; everything else is fixed):
 *   PLUS_PRICE_PI   the Plus price in Pi per 30 days (default 10, set by the owner 2026-11-27). AI_PLAN_PRICE is read as an
 *                   older alias. Testnet only.
 *   PI_NETWORK      ignored — the network is fixed to testnet (the Mainnet path was removed in v2.167). */
"use strict";

const num = (v) => (v !== undefined && v !== null && String(v).trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** Plus price in Pi: env PLUS_PRICE_PI → env AI_PLAN_PRICE → 10 (owner, 2026-11-27). null only if env sets a non-number. */
function plusPricePi(env = process.env) {
  if (env.PLUS_PRICE_PI !== undefined && String(env.PLUS_PRICE_PI).trim() !== "") return num(env.PLUS_PRICE_PI);
  if (env.AI_PLAN_PRICE !== undefined && String(env.AI_PLAN_PRICE).trim() !== "") return num(env.AI_PLAN_PRICE);
  return 10;
}

const D = {
  /* ---------- platform ---------- */
  network: "testnet", // fixed: there is no Mainnet path any more
  /** feature flags (GET /api/flags), all ON. community_lean_bootstrap stays ON: services/platform.js reads it to keep other
   *  members' memberships out of the bootstrap (privacy). The three flags no code read (stories, new_composer, data_saver)
   *  were deleted in v2.167. */
  flags: { passkeys: true, rum: true, community_lean_bootstrap: true },
  deadFlags: ["stories", "new_composer", "data_saver"],

  /* ---------- Plus membership (one plan, manual renewal: Pi has no recurring payments — no auto-renew) ---------- */
  plus: { periodDays: 30, autoRenew: false },
  /** approved 2026-11-23 (free / plus) */
  quotas: {
    saved_searches: { free: 25, plus: 100 },
    collections: { free: 50, plus: 200 },
    quiz_attempts_daily: { free: 10, plus: 30 },
    teams_owned: { free: 5, plus: 20 },
    team_members: { free: 50, plus: 150 }
  },

  /* ---------- مجتمع كوين (MJT): internal rewards balance, testnet app, no cash value ---------- */
  mjt: {
    /** legacy paths: every one stays ON (owner: hide nothing). Mining and the daily sign-in reward are counted inside the
     *  overall caps and pass the identity checks (v2.167). Buy-MJT-with-Pi stays as it is (501). */
    legacy: { transfers: true, tips: true, mining: true, checkin: true, conversion: true, pointRewards: true, ownerGrant: true, communityRewards: true },
    mining: { rate: 5, checkin: 1 }, // MJT per 24-hour session / per daily sign-in
    rules: { pointRewards: { dailyCap: 150 }, transfers: { maxSingle: 500, maxDaily: 2000, maxPerHour: 10, minAccountDays: 0 } },
    engine: { velocityPerHour: 10 },
    /** master plan §3 — identity checks + overall caps, always on */
    safety: {
      identity: { enabled: true, minAccountDays: 7, requirePi: true, linkedDetection: true, sharedIp: true, ipDays: 30, ipMaxAccounts: 5, clusterMin: 3, fanInDays: 7, fanInSenders: 3, applyEarn: true, applyTransfers: true, maxHeldPerSender: 5 },
      caps: { enabled: true, daily: 50, weekly: 250, monthly: 800, byLevel: true, level12: 30, level34: 40, level5: 50, countLegacy: true },
      course: { perLesson: true, amountPerLesson: 2, min: 10, max: 50 },
      activeWeek: { days: 5 },
      newcomerDays: 30
    },
    /** the 13 earn sources of the approved master-plan earn table (amount in MJT; caps = how many times per window) */
    sources: {
      answer_accepted: { amount: 10, daily: 5 },
      useful_post: { amount: 5, daily: 3 },
      article_published: { amount: 15, daily: 1, weekly: 4 },
      wiki_edit: { amount: 3, daily: 5 },
      report_confirmed: { amount: 3, daily: 5 },
      newcomer_help: { amount: 10, daily: 3 },
      friend_active: { amount: 20, monthly: 10 },
      quiz_passed: { amount: 2, daily: 10 },
      course_completed: { amount: 10, weekly: 2 }, // paid as 2 per lesson, between 10 and 50 (safety.course)
      exam_certified: { amount: 15, weekly: 2 },
      study_session: { amount: 2, weekly: 5 },
      daily_activity: { amount: 3, daily: 1 },
      active_week: { amount: 10, weekly: 1 }
    },
    /** «السمعة 2» always on */
    reputation: { enabled: true, pointsFactor: 0.5 },
    /** spends are burned (no treasury) */
    burnSpends: true,
    /** «خدمات مجتمع كوين» — approved services plan prices */
    services: {
      studio_extended: { cost: 150, days: 30, mode: "plus_mjt" },
      /** a published paid course is listed automatically; its tier follows the course size (published lessons) */
      course: { tiers: [{ maxLessons: 5, cost: 200 }, { maxLessons: 15, cost: 400 }, { maxLessons: Infinity, cost: 800 }], creatorShare: 0.5 },
      /** quota top-ups: 30 days, no stacking, never more than half the gap between Free and Plus */
      quota: {
        saved_searches: { cost: 60, days: 30, add: 25, title: "زيادة حصة البحث المحفوظ", benefit: "+25 بحثاً محفوظاً لمدة 30 يوماً" },
        collections: { cost: 60, days: 30, add: 50, title: "زيادة حصة المجموعات", benefit: "+50 مجموعة لمدة 30 يوماً" },
        teams_owned: { cost: 100, days: 30, add: 2, title: "زيادة حصة الفرق", benefit: "+2 فريق تملكه لمدة 30 يوماً" }
      },
      /** «تقدير»: burned, the author gains +1 reputation per appreciation (max +10 a day), from level 2 */
      appreciation: { amounts: [5, 10, 25], minLevel: 2, repPerItem: 1, repPerDay: 10, perDay: 20 }
    }
  },

  /* ---------- automatic decisions (replace every admin approval / review) ---------- */
  auto: {
    /** earn entries and member transfers held by the identity checks are released after this many hours unless the member
     *  was banned / suspended or reported in the meantime */
    holdReleaseHours: 72,
    /** a held transfer that still cannot be sent (balance spent, recipient closed) is cancelled after this — nothing moved */
    transferHoldExpireDays: 14,
    /** content queues: passes automod AND author level ≥ trustedLevel → published at once; otherwise published after
     *  publishAfterHours if nobody reported it */
    trustedLevel: 3,
    publishAfterHours: 24,
    /** reports: an item reported by `reports` distinct level ≥ `minLevel` accounts is hidden; it is restored after
     *  `restoreDays` unless the report was upheld (`upholdReports` distinct level ≥ minLevel reporters, or the author is
     *  banned / suspended), in which case it stays hidden and the author can appeal */
    reportHide: { reports: 3, minLevel: 3, restoreDays: 7, upholdReports: 6 },
    /** a business-ownership claim is granted automatically to a Pi-verified, non-minor account at least this old */
    bizClaimMinAccountDays: 7,
    sweepEveryMs: 60e3
  }
};

module.exports = { ...D, plusPricePi };
