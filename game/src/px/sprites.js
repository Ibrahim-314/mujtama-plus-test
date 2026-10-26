/* Pixel characters for the 2D world: 16×24 sprites drawn by code (no image files), four facings (down, up, left,
 * right) and three frames (stand, step, step), cached once per look. Each playable character of config.CHARS keeps
 * its colours and role; Salma, Abu Nasser and the people on the pavements have their own looks. */
import { bake } from "./core.js";

export const SW = 16, SH = 24;
const OUT = "#0b0a14";

export const LOOKS = {
  hoodie: { skin: "#d9a57a", hair: "#1c1410", style: "hood", top: "#1d6f8a", top2: "#2fe6ff", legs: "#232838", shoes: "#e8eef8" },
  "casual-f": { skin: "#e6b48c", hair: "#2a1622", style: "long", top: "#a8287a", top2: "#ff3fb4", legs: "#2c2340", shoes: "#f2e6ee" },
  suit: { skin: "#c98f62", hair: "#120e0c", style: "short", top: "#1f2236", top2: "#ffc23d", legs: "#1a1c2c", shoes: "#3a2a18" },
  casual: { skin: "#d39a6c", hair: "#3a2414", style: "short", top: "#1f7a5a", top2: "#3dffb0", legs: "#3a3428", shoes: "#2a2a2a" },
  "suit-f": { skin: "#e2ac84", hair: "#1a1018", style: "bun", top: "#3c2a78", top2: "#8a5cff", legs: "#24203c", shoes: "#151320" },
  salma: { skin: "#e2ac84", hair: "#1a1018", style: "scarf", top: "#24324e", top2: "#ffc23d", legs: "#1b2238", shoes: "#151320", scarf: "#3a4f7a" },
  nasser: { skin: "#b9805a", hair: "#d8d4cc", style: "shemagh", top: "#5a4630", top2: "#c8a060", legs: "#3a3226", shoes: "#2a2018", beard: "#e4e0d8" }
};
export const lookFor = (id) => LOOKS[id] || LOOKS.hoodie;

function person(c, L, dir, f) {
  const leg = f === 0 ? [0, 0] : f === 1 ? [-1, 1] : [1, -1], arm = f === 0 ? 0 : f === 1 ? 1 : -1;
  const side = dir >= 2, flip = dir === 2;
  const X = (x) => (flip ? SW - 1 - x : x);
  const r = (col, x, y, w, h) => { c.fillStyle = col; if (flip) c.fillRect(SW - x - w, y, w, h); else c.fillRect(x, y, w, h); };
  // legs + shoes
  if (side) { r(L.legs, 6, 17 + Math.min(0, leg[0]), 2, 5); r(L.legs, 8, 17 + Math.min(0, leg[1]), 2, 5); r(L.shoes, 6 + (leg[0] < 0 ? 1 : 0), 22, 3, 2); r(L.shoes, 8 + (leg[1] < 0 ? 1 : 0), 22, 3, 1); }
  else { r(L.legs, 5, 17, 2, 5 + leg[0]); r(L.legs, 9, 17, 2, 5 + leg[1]); r(L.shoes, 5, 22 + leg[0], 2, 2 - Math.max(0, leg[0])); r(L.shoes, 9, 22 + leg[1], 2, 2 - Math.max(0, leg[1])); }
  // torso
  r(OUT, 3, 10, 10, 8); r(L.top, 4, 10, 8, 8);
  if (dir === 0) { r(L.top2, 7, 11, 2, 6); if (L.style === "hood") { r(L.top2, 5, 10, 1, 3); r(L.top2, 10, 10, 1, 3); } }
  else if (dir === 1) r(L.top2, 4, 16, 8, 1);
  else r(L.top2, 9, 11, 2, 5);
  // arms
  if (side) { r(L.top, 6, 11 + arm, 3, 5); r(L.skin, 6, 16 + arm, 3, 1); }
  else { r(L.top, 2, 11 + arm, 2, 5); r(L.top, 12, 11 - arm, 2, 5); r(L.skin, 2, 16 + arm, 2, 1); r(L.skin, 12, 16 - arm, 2, 1); }
  // head
  r(OUT, 3, 2, 10, 9); r(L.skin, 4, 3, 8, 7);
  if (dir === 0) { r(OUT, 6, 6, 1, 2); r(OUT, 9, 6, 1, 2); r("#c0705a", 7, 8, 2, 1); }
  else if (side) { r(OUT, 10, 6, 1, 2); r(L.skin, 12, 6, 1, 2); }
  if (L.beard && dir !== 1) { if (side) r(L.beard, 8, 8, 4, 2); else r(L.beard, 5, 8, 6, 2); }
  // hair / headwear
  const H = L.hair;
  switch (L.style) {
    case "long": r(H, 3, 1, 10, 3); if (dir === 1) r(H, 3, 3, 10, 9); else if (side) { r(H, 3, 3, 4, 8); } else { r(H, 3, 3, 2, 8); r(H, 11, 3, 2, 8); } break;
    case "bun": r(H, 4, 1, 8, 3); r(H, 6, 0, 4, 2); if (dir === 1) r(H, 4, 3, 8, 5); else if (side) r(H, 3, 3, 3, 4); break;
    case "hood": r(L.top, 3, 1, 10, 3); if (dir === 1) r(L.top, 3, 3, 10, 7); else if (side) r(L.top, 3, 3, 4, 7); else { r(L.top, 3, 3, 1, 6); r(L.top, 12, 3, 1, 6); r(H, 4, 3, 8, 1); } break;
    case "scarf": { const S = L.scarf; r(S, 3, 1, 10, 3); if (dir === 1) r(S, 3, 3, 10, 8); else if (side) r(S, 3, 3, 5, 8); else { r(S, 3, 3, 2, 8); r(S, 11, 3, 2, 8); r(S, 4, 9, 8, 2); } r(L.top2, 7, 1, 2, 1); break; }
    case "shemagh": r("#e8e2d6", 3, 1, 10, 3); r("#b8323a", 4, 1, 1, 1); r("#b8323a", 8, 1, 1, 1); r("#b8323a", 11, 2, 1, 1); r(OUT, 3, 1, 10, 1);
      if (dir === 1) r("#e8e2d6", 3, 3, 10, 8); else if (side) r("#e8e2d6", 3, 3, 4, 8); else { r("#e8e2d6", 3, 3, 1, 7); r("#e8e2d6", 12, 3, 1, 7); } break;
    default: r(H, 4, 1, 8, 3); if (dir === 1) r(H, 4, 3, 8, 4); else if (side) r(H, 3, 3, 3, 3); else r(H, 4, 3, 1, 1);
  }
  void X;
}

const cache = new Map();
/** the sheet for a look: 4 facings × 3 frames of 16×24 */
export function sheet(id) {
  if (cache.has(id)) return cache.get(id);
  const L = lookFor(id);
  const cv = bake(SW * 3, SH * 4, (c) => { for (let d = 0; d < 4; d++) for (let f = 0; f < 3; f++) { c.save(); c.translate(f * SW, d * SH); person(c, L, d, f); c.restore(); } });
  cache.set(id, cv); return cv;
}

/** draw a character standing at screen (x, y) = the point between its feet */
export function drawPerson(c, id, x, y, dir, frame, opts = {}) {
  c.fillStyle = "rgba(0,0,0,.4)"; c.fillRect(x - 5, y - 1, 10, 2); c.fillRect(x - 4, y - 2, 8, 4);
  const lift = opts.lift || 0;
  c.drawImage(sheet(id), frame * SW, dir * SH, SW, SH, Math.round(x - SW / 2), Math.round(y - SH + 1 - lift), SW, SH);
}

/** heading (atan2(dx, dz), as the 3D heroes keep it) → facing index: 0 down (+z), 1 up (−z), 2 left (−x), 3 right (+x) */
export const facing = (h) => { const dx = Math.sin(h), dz = Math.cos(h); return Math.abs(dx) > Math.abs(dz) * 1.1 ? (dx < 0 ? 2 : 3) : dz >= 0 ? 0 : 1; };
