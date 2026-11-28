/* =====================================================================
 * v2.160 — «محفظة المكافآت»: rides the lazy `mjt` chunk (index.html, same data-chunk); 0 bytes in core.
 *   #/rewards[?tab=history|review]  v2.164 (phase 8.0): an alias of the one wallet page #/mjt
 *                                   (#/rewards → #/mjt, ?tab=history → #/mjt?tab=history, ?tab=review → #/mjt?tab=review).
 * v2.167: the admin page #/admin/rewards was removed — the 13 earn sources are fixed and always on
 * (server/config/app-defaults.js), and held rewards are released automatically after 72 hours.
 * ===================================================================== */
(function RewardsUI() {
  if (window.MPRewards) return;
  const qs = () => new URLSearchParams((location.hash.split("?")[1] || ""));
  /** v2.164: #/rewards is an alias of the one wallet page; replace() keeps «back» from bouncing between the two */
  const redirect = () => { const t = qs().get("tab"); location.replace(t === "history" || t === "review" ? "#/mjt?tab=" + t : "#/mjt"); };
  MPRoutes.extend(() => ({ rewards: () => redirect() }));
  window.MPRewards = { redirect, version: "2.167.0" };
  if (/^#\/rewards\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
