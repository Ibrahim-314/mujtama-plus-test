/* Central permission policy (Phase 8). One place answers "may A do X to B?" for following,
 * messaging, mentioning, commenting and seeing content, so every service applies the same rules.
 * privacy = { dm: everyone|following|nobody, mentions: everyone|following|nobody,
 *             comments: everyone|following|nobody, filterRequests: bool }  */
const DEFAULTS = { dm: "everyone", mentions: "everyone", comments: "everyone", filterRequests: true };
const privacyOf = u => ({ ...DEFAULTS, ...(u?.privacy || {}) });
const { wordHit } = require("../../protection-core.js"); // Arabic-aware matching (phase 33)
function createPolicy(db) {
  const follows = async (src, dst) => !!(await db.get("SELECT 1 x FROM follows WHERE src=$1 AND dst=$2", [src, dst]));
  // explicit blocks + accounts linked to them (prefs.blockedLinked, maintained by services/protection.js)
  const blocked = (owner, other) => (owner?.prefs?.blocked || []).includes(other) || (owner?.prefs?.blockedLinked || []).includes(other);
  /* extra async checks registered by services (phase 33 protection mode): guard(actorId, target, key) → false denies */
  const guards = [];
  const rule = async (actorId, target, key) => {
    if (!target || actorId === target.id) return true;
    if (blocked(target, actorId)) return false;
    for (const g of guards) if ((await g(actorId, target, key)) === false) return false;
    const v = privacyOf(target)[key];
    if (v === "nobody") return false;
    if (v === "following") return follows(target.id, actorId); // target must follow the actor
    return true;
  };
  return {
    privacyOf,
    follows,
    addGuard: fn => { if (typeof fn === "function" && !guards.includes(fn)) guards.push(fn); },
    /* "direct" | "request" | false */
    async followMode(actorId, target) {
      if (!target || blocked(target, actorId)) return false;
      return target.private ? "request" : "direct";
    },
    canMention: (actorId, target) => rule(actorId, target, "mentions"),
    canComment: (actorId, postAuthor) => rule(actorId, postAuthor, "comments"),
    /* "inbox" | "requests" | false — non-followers land in Requests when filterRequests is on */
    async messageMode(actorId, target) {
      if (!(await rule(actorId, target, "dm"))) return false;
      if (privacyOf(target).filterRequests && !(await follows(target.id, actorId))) return "requests";
      return "inbox";
    },
    /* content visibility given preloaded facts; used by canSee and filterVisible */
    visible(row, viewer, { author, followsAuthor, closeFriend, communityOk }) {
      if (row.author === viewer) return true;
      if (row.status !== "published") return false;
      if (blocked(author, viewer)) return false;
      if (!communityOk) return false;
      if (author?.private && !followsAuthor && row.visibility !== "private") return false;
      if (row.visibility === "public") return true;
      if (row.visibility === "followers") return followsAuthor;
      if (row.visibility === "close") return closeFriend;
      if (row.visibility === "list") {
        const l = (author?.prefs?.lists || []).find(x => x.id === row.data?.list);
        return !!l && l.members.includes(viewer);
      }
      return false;
    },
    mutedWordHit(text, words) {
      if (!words?.length || !text) return false;
      return words.some(w => w && wordHit(text, String(w), false));
    }
  };
}
module.exports = { createPolicy, DEFAULTS, privacyOf };
