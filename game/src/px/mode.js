/* Which world the game draws: "pixel" (2D pixel art, the default from 2026-10-27) or "3d" (the Babylon.js world,
 * kept as a recoverable option in Settings → Graphics). The choice is a setting in the player's save; ?world=3d in
 * the address forces the 3D world for one visit. The story, saves and missions are the same in both. */
export function worldMode(game) {
  try { const q = new URLSearchParams(location.search).get("world"); if (q === "3d" || q === "pixel") return q; } catch { /* */ }
  return game?.save?.data?.settings?.world === "3d" ? "3d" : "pixel";
}
export const isPixel = (game) => worldMode(game) === "pixel";
