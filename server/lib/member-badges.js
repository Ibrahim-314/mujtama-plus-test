/* v2.62 light feature: community member badges, computed from memberships.joined_at (no migration).
 *   new   — first 7 days since joining THIS community: now - joined in [0, 7d)
 *   anniv — the week starting on each join anniversary (years ≥ 1): now in [anniv, anniv + 7d)
 * A Feb 29 join celebrates on Feb 28 in common years. All dates in UTC. */
const DAY = 864e5, NEW_DAYS = 7, ANNIV_DAYS = 7;
/** the n-th anniversary of `j` (Date, UTC), clamping Feb 29 → Feb 28 */
function annivAt(j, n) {
  const y = j.getUTCFullYear() + n, m = j.getUTCMonth(), last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(j.getUTCDate(), last), j.getUTCHours(), j.getUTCMinutes(), j.getUTCSeconds());
}
/** → { kind: "new" } | { kind: "anniv", years } | null
 * The community owner joined at creation time, so «عضو جديد» is meaningless for them: owners skip "new" (anniversaries still apply). */
function badgeFor(joinedAt, now = Date.now(), role = "") {
  const j = joinedAt ? new Date(joinedAt) : null; if (!j || isNaN(+j)) return null;
  const t = +now, age = t - +j; if (age < 0) return null;
  if (age < NEW_DAYS * DAY) return role === "owner" ? null : { kind: "new" };
  for (let n = Math.max(1, new Date(t).getUTCFullYear() - j.getUTCFullYear() - 1); n <= new Date(t).getUTCFullYear() - j.getUTCFullYear(); n++) {
    const a = annivAt(j, n); if (t >= a && t < a + ANNIV_DAYS * DAY) return { kind: "anniv", years: n };
  }
  return null;
}
/** settings switch: ON unless the owner turned it off */
const enabled = (settings) => (settings || {}).memberBadges !== false;
module.exports = { badgeFor, annivAt, enabled, NEW_DAYS, ANNIV_DAYS };
