/* «المدينة الرقمية» in 2D pixel art (Season 1 world conversion, 2026-10-27): the shared pieces of the pixel world.
 * One plain <canvas> 2D context at a low virtual resolution, scaled up by CSS with crisp pixels — no WebGL, no library.
 * The world keeps the 3D scenes' own coordinates (metres: x across, z along, the tower at negative z), so story spots,
 * saved positions and the game's test hooks stay the same; the camera looks straight down in a Pokémon-style 3/4 view:
 * screen x = x, screen y = z − height. PPM pixels per metre. */
export const PPM = 16;

/** a seeded random source (the same city every visit) */
export const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The pixel view: a canvas over the game's stage. `fit(cssW, cssH)` returns how many metres should fit across/down. */
export function makeView(game, fitM) {
  const canvas = document.createElement("canvas");
  canvas.className = "gm-canvas gm-px"; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-hidden", "true");
  game.surface.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: false });
  const v = { canvas, ctx, W: 1, H: 1, scale: 2, cam: { x: 0, z: 0 }, shake: 0 };
  v.resize = () => {
    const r = game.surface.getBoundingClientRect(), cw = Math.max(1, r.width), ch = Math.max(1, r.height);
    const [mw, mh] = fitM(cw, ch);
    // whole DEVICE pixels per art pixel (crisp on every screen), as large as fits the metres the scene asks for
    const dpr = Math.max(1, Math.min(4, devicePixelRatio || 1)), dev = clamp(Math.floor(Math.min(cw / (mw * PPM), ch / (mh * PPM)) * dpr), Math.ceil(dpr * 1.5), 8 * dpr);
    v.scale = dev / dpr;
    v.W = Math.ceil(cw / v.scale); v.H = Math.ceil(ch / v.scale);
    if (canvas.width !== v.W || canvas.height !== v.H) { canvas.width = v.W; canvas.height = v.H; }
    canvas.style.width = v.W * v.scale + "px"; canvas.style.height = v.H * v.scale + "px";
    ctx.imageSmoothingEnabled = false;
  };
  /** world → virtual pixel (rounded: everything lands on whole pixels) */
  v.sx = (x) => Math.round((x - v.cam.x) * PPM + v.W / 2);
  v.sy = (z, y = 0) => Math.round((z - y - v.cam.z) * PPM + v.H / 2);
  /** a tap in normalised coords (−1…1, y up) → the world point under it on the ground */
  v.toWorld = (nx, ny) => ({ x: v.cam.x + ((nx + 1) / 2 * v.W - v.W / 2) / PPM, z: v.cam.z + ((1 - ny) / 2 * v.H - v.H / 2) / PPM });
  v.onScreen = (x, z, m = 2) => Math.abs(x - v.cam.x) * PPM < v.W / 2 + m * PPM && Math.abs(z - v.cam.z) * PPM < v.H / 2 + m * PPM * 3;
  const onR = () => v.resize(); addEventListener("resize", onR); v.resize();
  v.dispose = () => { removeEventListener("resize", onR); canvas.remove(); };
  return v;
}

/** pixel rectangles in world space (metres): x, z of the top-left, w, d in metres; h lifts it (metres up) */
export const rect = (v, col, x, z, w, d) => { v.ctx.fillStyle = col; const x0 = v.sx(x), y0 = v.sy(z); v.ctx.fillRect(x0, y0, Math.max(1, v.sx(x + w) - x0), Math.max(1, v.sy(z + d) - y0)); };
export const px = (c, col, x, y, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w, h); };

/** a soft additive light pool (lamps, neon, screens): radial gradient, cached per colour/radius */
const glowCache = new Map();
export function glow(c, x, y, r, col, a = 1) {
  r = Math.max(2, Math.round(r)); const k = col + r;
  let g = glowCache.get(k);
  if (!g) {
    g = document.createElement("canvas"); g.width = g.height = r * 2; const gx = g.getContext("2d");
    const gr = gx.createRadialGradient(r, r, 0, r, r, r); gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)");
    gx.fillStyle = gr; gx.fillRect(0, 0, r * 2, r * 2); glowCache.set(k, g);
  }
  const o = c.globalCompositeOperation, oa = c.globalAlpha; c.globalCompositeOperation = "lighter"; c.globalAlpha = a;
  c.drawImage(g, Math.round(x - r), Math.round(y - r)); c.globalCompositeOperation = o; c.globalAlpha = oa;
}

/** a tiny 3×5 pixel font for signs drawn into the world (Latin capitals, digits and a few marks) */
const F = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111", F: "111100110100100",
  G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100", Q: "010101101110011", R: "110101110101101",
  S: "011100010001110", T: "111010010010010", U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111", 0: "111101101101111", 1: "010110010010111", 2: "110001010100111", 3: "110001010001110",
  4: "101101111001001", 5: "111100110001110", 6: "011100111101111", 7: "111001010010010", 8: "111101111101111", 9: "111101111001110",
  "-": "000000111000000", ".": "000000000000010", ":": "000010000010000", "·": "000000010000000", " ": "000000000000000", "/": "001001010100100"
};
export function text(c, s, x, y, col, k = 1) {
  c.fillStyle = col; let cx = Math.round(x);
  for (const ch of String(s).toUpperCase()) {
    const g = F[ch] || F[" "];
    for (let i = 0; i < 15; i++) if (g[i] === "1") c.fillRect(cx + (i % 3) * k, Math.round(y) + Math.floor(i / 3) * k, k, k);
    cx += 4 * k;
  }
}
export const textW = (s, k = 1) => String(s).length * 4 * k - k;

/** an offscreen canvas painted once (tiles, buildings, sprites) */
export function bake(w, h, draw) { const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h)); const c = cv.getContext("2d"); c.imageSmoothingEnabled = false; draw(c, cv.width, cv.height); return cv; }

/** the marker over a usable spot: a bobbing pixel diamond, gold for story goals, with a halo ring on the ground when close */
export function marker(c, x, y, col, t, big = false) {
  const b = Math.round(Math.sin(t * 3.2) * 2), s = big ? 4 : 3;
  glow(c, x, y + b, big ? 14 : 9, col, 0.55);
  c.fillStyle = col;
  for (let i = 0; i <= s; i++) { c.fillRect(x - i, y + b - s + i, i * 2 + 1, 1); c.fillRect(x - i, y + b + s - i, i * 2 + 1, 1); }
  c.fillStyle = "#ffffff"; c.fillRect(x - 1, y + b - 1, 1, 1);
}
export function halo(c, x, y, col, a, t) {
  if (a < 0.02) return;
  const r = 9 + Math.sin(t * 4) * 1.2; c.globalAlpha = a; c.strokeStyle = col; c.lineWidth = 1;
  c.beginPath(); c.ellipse(x + 0.5, y + 0.5, r, r * 0.5, 0, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
}

/** The night skyline of 2077 after the Great Blackout: towers, a few dark districts, the golden MJT tower with its coin.
 * Painted into the room's window and full screen when the player looks out. */
export function skyline(c, x0, y0, w, h, t, k = 1) {
  const R = rng(4077);
  const g = c.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, "#070a22"); g.addColorStop(0.6, "#1d1240"); g.addColorStop(1, "#3a1a4a");
  c.fillStyle = g; c.fillRect(x0, y0, w, h);
  for (let i = 0; i < w * h / 160; i++) { const sx = x0 + R() * w, sy = y0 + R() * h * 0.5; c.fillStyle = R() < 0.3 ? "#9fb4ff" : "#4a5390"; c.fillRect(sx | 0, sy | 0, 1, 1); }
  const base = y0 + h, tw = 14 * k, cx = x0 + w / 2;
  for (let layer = 0; layer < 3; layer++) {
    const col = ["#151a3c", "#10142e", "#0a0c1f"][layer], lit = ["#3a4a8a", "#ffcf6a", "#2fe6ff"][layer];
    let x = x0 - 4;
    while (x < x0 + w) {
      const bw = (6 + R() * 12) * k, bh = (h * (0.25 + R() * 0.45)) * (1 - layer * 0.18);
      if (Math.abs(x + bw / 2 - cx) > tw + 6 * k) {
        c.fillStyle = col; c.fillRect(x | 0, (base - bh) | 0, Math.ceil(bw), Math.ceil(bh));
        const dark = R() < 0.3; // a district still dark since the blackout
        if (!dark) for (let wy = base - bh + 3 * k; wy < base - 2; wy += 3 * k) for (let wx = x + 2 * k; wx < x + bw - 2; wx += 3 * k) if (R() < 0.4) { c.fillStyle = lit; c.globalAlpha = 0.35 + R() * 0.5 + (R() < 0.04 ? Math.sin(t * 6) * 0.3 : 0); c.fillRect(wx | 0, wy | 0, k, k); c.globalAlpha = 1; }
        if (R() < 0.25) { c.fillStyle = R() < 0.5 ? "#ff3fb4" : "#2fe6ff"; c.fillRect((x + bw / 2) | 0, (base - bh - 3 * k) | 0, k, 3 * k); }
      }
      x += bw + R() * 3 * k;
    }
  }
  // the MJT tower: a tapering golden needle with a ring and the glowing coin
  const th = h * 0.92, top = base - th;
  glow(c, cx, top + th * 0.25, 40 * k, "rgba(255,194,61,.35)", 0.8);
  for (let yy = 0; yy < th; yy++) {
    const f = yy / th, half = Math.max(1, Math.round(tw * (0.25 + f * 0.75) / 2));
    c.fillStyle = yy % (4 * k) < k ? "#ffe39a" : f < 0.5 ? "#c88a22" : "#8a5a14";
    c.fillRect(Math.round(cx - half), Math.round(top + yy), half * 2, 1);
    if (yy % (3 * k) === 0 && yy > 10) { c.fillStyle = "#fff2c4"; c.globalAlpha = 0.5; c.fillRect(Math.round(cx - half + k), Math.round(top + yy), Math.max(1, half * 2 - 2 * k), Math.max(1, k >> 1)); c.globalAlpha = 1; }
  }
  const cy = top + th * 0.18, cr = 5 * k, pulse = 0.75 + Math.sin(t * 2) * 0.25;
  glow(c, cx, cy, cr * 4, "rgba(255,210,90,.9)", pulse);
  c.fillStyle = "#ffc23d"; c.beginPath(); c.arc(cx, cy, cr, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#7a4c0c"; c.fillRect(Math.round(cx - k), Math.round(cy - cr * 0.6), 2 * k, Math.round(cr * 1.2));
  c.fillStyle = "#ffe39a"; c.fillRect(Math.round(cx - cr * 0.6), Math.round(cy - k / 2), Math.round(cr * 1.2), Math.max(1, k));
}
