/* Phase 2D-A — the game's missions: a fixed catalogue owned by the server (pure, no I/O except the read-only checks).
 * Mission ids, their order (requires), the XP each one gives, the chapter it opens and the level curve live HERE, never
 * in the client: POST /api/game/missions/:id/complete takes no body, so a client cannot send an XP amount, a level, a
 * chapter or a "done" flag. Story flags (game_players.flags) are presentation only and are never read here.
 *
 * Two kinds of check, named honestly:
 *   verify "story"   story-flow only. The server enforces the order (prerequisites), one completion per member
 *                    (PRIMARY KEY), a sane minimum play time where it applies, and the fixed XP. It CANNOT prove that the
 *                    player physically walked to a door or a tower in the 3D scene — that happens on the device.
 *   verify "server"  backed by a record the server itself wrote (e.g. a mining session row) — checked read-only.
 * No mission moves money: Phase A awards in-game XP only. No MJT is created, minted, transferred or read for value. */

const SEC = 1000;

/** @typedef {{ id: string, chapter: number, opens?: number, requires: string[], xp: number, verify: "story"|"server",
 *   minAfterStart?: number, check?: string, title: { ar: string, en: string } }} Mission */

/** @type {Mission[]} order = story order */
const MISSIONS = [
  { id: "c0.explore", chapter: 0, requires: [], xp: 100, verify: "story", minAfterStart: 15 * SEC,
    title: { ar: "استكشف شقتك الجديدة", en: "Explore your new apartment" } },
  { id: "c0.leave", chapter: 0, opens: 1, requires: ["c0.explore"], xp: 50, verify: "story",
    title: { ar: "اخرج إلى المدينة", en: "Step out into the city" } },
  { id: "c1.tower", chapter: 1, requires: ["c0.leave"], xp: 150, verify: "story",
    title: { ar: "ادخل برج MJT", en: "Enter the MJT tower" } },
  { id: "c0.mining", chapter: 0, requires: [], xp: 50, verify: "server", check: "mining_session",
    title: { ar: "شغّل جهاز التعدين", en: "Start your mining rig" } }
];
const BY_ID = new Map(MISSIONS.map((m) => [m.id, m]));
const ID_RE = /^[a-z0-9]{1,8}\.[a-z0-9_]{1,24}$/;

/** XP needed to reach a level: level L starts at 50·L·(L−1) XP (1→0, 2→100, 3→300, 4→600, 5→1000). */
const levelStart = (L) => 50 * L * (L - 1);
const MAX_LEVEL = 99;
function levelFor(xp) {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  let L = 1;
  while (L < MAX_LEVEL && levelStart(L + 1) <= x) L++;
  return L;
}
/** the progress block every response carries; computed only from server values */
function progressOf(player) {
  const xp = Math.max(0, Number(player?.xp) || 0), level = levelFor(xp);
  const from = levelStart(level), to = level >= MAX_LEVEL ? from : levelStart(level + 1);
  return { xp, level, chapter: Number(player?.chapter) || 0, levelFrom: from, levelTo: to,
    pct: to > from ? Math.min(100, Math.round(((xp - from) / (to - from)) * 100)) : 100 };
}

/** the mission list for a member: done / locked / available, in story order */
function listFor(doneMap) {
  return MISSIONS.map((m) => {
    const d = doneMap.get(m.id);
    return { id: m.id, chapter: m.chapter, xp: m.xp, verify: m.verify, title: m.title,
      done: !!d, completedAt: d ? d.completed_at : null, locked: !d && m.requires.some((r) => !doneMap.has(r)) };
  });
}

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));

module.exports = { MISSIONS, BY_ID, ID_RE, levelFor, levelStart, progressOf, listFor, ms, MAX_LEVEL };
