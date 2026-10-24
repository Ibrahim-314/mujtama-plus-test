/* The city as seen from the apartment window — a painted, layered backdrop instead of a full 3D skyline.
 * Three planes behind the glass give real parallax when the player walks: far sky + distant towers, a middle band of
 * towers with the gold MJT Core and its beam, and a near pair of dark towers framing the view. Windows are painted
 * once into canvases (no per-frame cost); flying-car lights and rain on the glass are added in the shader.
 * windowMaterial({ hi }) → the ShaderMaterial for the window glass (set .uniforms.uTime each frame) */
import { CanvasTexture, SRGBColorSpace, ShaderMaterial } from "three";

const rand = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const WINDOW_COLS = ["#ffd38a", "#ffe9c2", "#9fe8ff", "#ffb36b", "#f7f2ff", "#ff9fd8"];

function tex(cv) { const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; return t; }

/** one tower: body with a subtle vertical gradient, lit windows on a grid, an occasional neon band or roof sign */
function tower(x, r, bx, top, w, base, o) {
  const g = x.createLinearGradient(bx, top, bx + w, top); g.addColorStop(0, o.body2); g.addColorStop(0.5, o.body); g.addColorStop(1, o.body2);
  x.fillStyle = g; x.fillRect(bx, top, w, base - top);
  // roof detail
  if (r() < 0.5) { x.fillRect(bx + w * 0.3, top - w * 0.25, w * 0.4, w * 0.25); }
  if (r() < 0.35) { x.fillRect(bx + w * 0.48, top - w * 0.9, Math.max(1, w * 0.04), w * 0.9); o.beacons.push([bx + w * 0.5, top - w * 0.9]); }
  // windows
  const cw = o.win, ch = o.win * 1.5, gx = o.win * 0.7, gy = o.win * 0.9, lit = o.lit * (0.6 + r() * 0.8);
  const tint = WINDOW_COLS[Math.floor(r() * WINDOW_COLS.length)];
  for (let yy = top + gy * 2; yy < base - ch; yy += ch + gy) {
    const rowLit = r() < 0.85;
    for (let xx = bx + gx; xx < bx + w - cw; xx += cw + gx) {
      if (!rowLit || r() > lit) continue;
      x.globalAlpha = 0.45 + r() * 0.55; x.fillStyle = r() < 0.8 ? tint : WINDOW_COLS[Math.floor(r() * WINDOW_COLS.length)];
      x.fillRect(xx, yy, cw, ch);
    }
  }
  x.globalAlpha = 1;
  // neon band / sign
  if (r() < o.neon) {
    const c = ["#ff3fb4", "#2fe6ff", "#8a5cff", "#3dffb0"][Math.floor(r() * 4)];
    x.shadowColor = c; x.shadowBlur = o.win * 3; x.fillStyle = c;
    if (r() < 0.5) x.fillRect(bx, top + (base - top) * (0.1 + r() * 0.3), w, Math.max(2, o.win * 0.5));
    else { const sw = w * 0.7, sh = o.win * 3; x.fillRect(bx + (w - sw) / 2, top + o.win * 2, sw, sh); x.fillStyle = "rgba(0,0,0,.55)"; x.fillRect(bx + (w - sw) / 2 + 3, top + o.win * 2 + 3, sw - 6, sh - 6); x.fillStyle = c; x.fillRect(bx + (w - sw) / 2 + sw * 0.15, top + o.win * 2 + sh * 0.4, sw * 0.7, sh * 0.2); }
    x.shadowBlur = 0;
  }
}

function beaconDots(x, list) { x.shadowColor = "#ff3344"; x.shadowBlur = 8; x.fillStyle = "#ff5566"; for (const [bx, by] of list) { x.beginPath(); x.arc(bx, by, 2, 0, Math.PI * 2); x.fill(); } x.shadowBlur = 0; }

function farLayer(W, H, seed) {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const x = cv.getContext("2d"), r = rand(seed);
  // night sky: deep blue → violet haze at the horizon (the city's light pollution)
  const hz = H * 0.52;
  const sky = x.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#03041a"); sky.addColorStop(0.32, "#0b0c35"); sky.addColorStop(0.5, "#3a1a5e"); sky.addColorStop(0.56, "#7a2f6e"); sky.addColorStop(0.62, "#1a0f33"); sky.addColorStop(1, "#05040e");
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  // stars
  for (let i = 0; i < 420; i++) { const y = r() * hz * 0.8; x.globalAlpha = (1 - y / hz) * (0.3 + r() * 0.7); x.fillStyle = "#fff"; const s = r() < 0.08 ? 2 : 1; x.fillRect(r() * W, y, s, s); }
  x.globalAlpha = 1;
  // moon with halo
  const mx = W * 0.78, my = H * 0.17, mr = H * 0.035;
  const halo = x.createRadialGradient(mx, my, mr, mx, my, mr * 9); halo.addColorStop(0, "rgba(200,215,255,.35)"); halo.addColorStop(1, "rgba(200,215,255,0)");
  x.fillStyle = halo; x.fillRect(mx - mr * 9, my - mr * 9, mr * 18, mr * 18);
  x.fillStyle = "#eef1ff"; x.beginPath(); x.arc(mx, my, mr, 0, Math.PI * 2); x.fill();
  x.fillStyle = "rgba(160,170,210,.35)"; x.beginPath(); x.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.25, 0, Math.PI * 2); x.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.18, 0, Math.PI * 2); x.fill();
  // thin clouds
  for (let i = 0; i < 9; i++) { const cy = H * (0.12 + r() * 0.3), cx = r() * W, cw = W * (0.15 + r() * 0.25); const cg = x.createLinearGradient(cx, cy, cx + cw, cy); cg.addColorStop(0, "rgba(120,90,180,0)"); cg.addColorStop(0.5, `rgba(120,90,180,${0.08 + r() * 0.1})`); cg.addColorStop(1, "rgba(120,90,180,0)"); x.fillStyle = cg; x.fillRect(cx, cy, cw, H * 0.012); }
  // distant towers: two rows, small windows, fading into haze
  const beacons = [];
  for (const row of [{ base: hz + H * 0.08, min: 0.04, max: 0.16, w: [0.012, 0.03], c: "#140f2e", c2: "#0e0a22", lit: 0.35, win: Math.max(1, W / 1100) }, { base: hz + H * 0.2, min: 0.08, max: 0.26, w: [0.02, 0.045], c: "#0d0b22", c2: "#080716", lit: 0.45, win: Math.max(1.5, W / 800) }]) {
    for (let bx = -10; bx < W; ) { const w = W * (row.w[0] + r() * (row.w[1] - row.w[0])); const top = row.base - H * (row.min + r() * (row.max - row.min)); tower(x, r, bx, top, w, H, { body: row.c, body2: row.c2, lit: row.lit, win: row.win, neon: 0.12, beacons }); bx += w + r() * W * 0.004; }
    // haze over the row
    const hg = x.createLinearGradient(0, row.base - H * 0.3, 0, H); hg.addColorStop(0, "rgba(90,40,120,0)"); hg.addColorStop(0.5, "rgba(90,40,120,.18)"); hg.addColorStop(1, "rgba(10,6,24,.4)"); x.fillStyle = hg; x.fillRect(0, row.base - H * 0.3, W, H);
  }
  beaconDots(x, beacons);
  return { cv, beacons };
}

function midLayer(W, H, seed) {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const x = cv.getContext("2d"), r = rand(seed), beacons = [];
  const base = H;
  // the MJT Core: a tall gold-banded tower slightly left of centre with a light beam into the sky
  const cx = W * 0.12, cw = W * 0.03, ctop = H * 0.35;
  const beam = x.createLinearGradient(cx, 0, cx, ctop); beam.addColorStop(0, "rgba(255,194,61,0)"); beam.addColorStop(1, "rgba(255,194,61,.55)");
  x.fillStyle = beam; x.fillRect(cx + cw * 0.38, 0, cw * 0.24, ctop);
  const cg = x.createLinearGradient(cx, 0, cx + cw, 0); cg.addColorStop(0, "#1b1424"); cg.addColorStop(0.5, "#2c2033"); cg.addColorStop(1, "#140f1c");
  x.fillStyle = cg; x.beginPath(); x.moveTo(cx + cw * 0.5, ctop - H * 0.06); x.lineTo(cx + cw, ctop + H * 0.04); x.lineTo(cx + cw, base); x.lineTo(cx, base); x.lineTo(cx, ctop + H * 0.04); x.closePath(); x.fill();
  x.shadowColor = "#ffc23d"; x.shadowBlur = 18; x.fillStyle = "#ffc23d";
  for (let i = 0; i < 9; i++) x.fillRect(cx, ctop + H * 0.06 + i * H * 0.075, cw, Math.max(2, H * 0.006));
  x.fillRect(cx + cw * 0.47, ctop - H * 0.06, cw * 0.06, H * 0.1);
  x.shadowBlur = 0;
  beacons.push([cx + cw * 0.5, ctop - H * 0.06]);
  // towers either side
  for (let bx = -20; bx < W; ) {
    const w = W * (0.035 + r() * 0.05);
    if (bx + w > cx - 4 && bx < cx + cw + 4) { bx = cx + cw + 6; continue; }
    const top = H * (0.3 + r() * 0.4);
    tower(x, r, bx, top, w, base, { body: "#0a0918", body2: "#05050e", lit: 0.5, win: Math.max(2, W / 520), neon: 0.35, beacons });
    bx += w + W * (0.004 + r() * 0.012);
  }
  // street-level glow at the bottom
  const sg = x.createLinearGradient(0, H * 0.75, 0, H); sg.addColorStop(0, "rgba(255,120,60,0)"); sg.addColorStop(1, "rgba(255,120,60,.22)"); x.fillStyle = sg; x.fillRect(0, H * 0.75, W, H * 0.25);
  beaconDots(x, beacons);
  return { cv, beacons };
}

function nearLayer(W, H, seed) {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const x = cv.getContext("2d"), r = rand(seed), beacons = [];
  // two close towers at the edges of the view; the middle stays open
  for (const [bx, w, top] of [[0, W * 0.16, H * 0.18], [W * 0.84, W * 0.16, H * 0.3]]) tower(x, r, bx, top, w, H, { body: "#07060f", body2: "#030308", lit: 0.42, win: Math.max(3, W / 210), neon: 1, beacons });
  beaconDots(x, beacons);
  return { cv, beacons };
}


/** the MJT Core — the golden supertall of the story. Stepped glass tiers with gold setback rims, vertical
 * mullions, a sky reflection, a glowing halo crown carrying the MJT coin, and a needle spire. Own layer, centred. */
function coreLayer(W, H) {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const x = cv.getContext("2d");
  const cx = W / 2, rnd = rand(71);
  // tiers bottom→top: [yTop, halfWidth]
  const tiers = [[0.60, 0.34], [0.43, 0.27], [0.31, 0.205], [0.235, 0.15]].map(([y, w]) => [y * H, w * W]);
  const crownTop = H * 0.15, spireTop = H * 0.035;
  // atmospheric glow behind the whole tower
  const glow = x.createRadialGradient(cx, H * 0.25, 0, cx, H * 0.25, W * 0.55);
  glow.addColorStop(0, "rgba(255,190,90,.20)"); glow.addColorStop(1, "rgba(255,190,90,0)");
  x.fillStyle = glow; x.fillRect(0, 0, W, H * 0.7);
  const glass = (x0, x1) => {
    const g = x.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, "#0b0a10"); g.addColorStop(0.22, "#1d1a1f"); g.addColorStop(0.36, "#5a4526");
    g.addColorStop(0.42, "#2c2418"); g.addColorStop(0.7, "#141218"); g.addColorStop(1, "#08070b");
    return g;
  };
  let bottom = H;
  for (const [yTop, hw] of tiers) {
    const x0 = cx - hw, x1 = cx + hw;
    x.fillStyle = glass(x0, x1); x.fillRect(x0, yTop, hw * 2, bottom - yTop);
    // vertical reflection of the sky fading down the face
    const v = x.createLinearGradient(0, yTop, 0, bottom); v.addColorStop(0, "rgba(120,140,190,.16)"); v.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = v; x.fillRect(x0, yTop, hw * 2, bottom - yTop);
    // mullions
    const step = Math.max(3, W * 0.024);
    for (let mx = x0 + step; mx < x1 - 1; mx += step) { x.fillStyle = "rgba(255,210,140,.10)"; x.fillRect(mx, yTop, 1, bottom - yTop); }
    // floor bands + sparse warm windows
    const fh = Math.max(3, H * 0.0065);
    for (let fy = yTop + fh; fy < bottom; fy += fh) {
      x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(x0, fy, hw * 2, 1);
      for (let mx = x0 + 1; mx < x1 - step; mx += step) if (rnd() < 0.11) { x.fillStyle = `rgba(255,${190 + rnd() * 40 | 0},130,${0.2 + rnd() * 0.3})`; x.fillRect(mx + 2, fy + 1, step - 4, fh - 2); }
    }
    // gold setback rim with a soft glow
    x.save(); x.shadowColor = "rgba(255,196,90,.9)"; x.shadowBlur = W * 0.03;
    x.fillStyle = "#ffcf6a"; x.fillRect(x0 - W * 0.006, yTop, hw * 2 + W * 0.012, Math.max(2, H * 0.004)); x.restore();
    // corner edge highlight
    x.fillStyle = "rgba(255,214,150,.35)"; x.fillRect(x0, yTop, Math.max(1, W * 0.004), bottom - yTop);
    bottom = yTop;
  }
  // central light seam
  const seam = x.createLinearGradient(0, tiers[3][0], 0, H); seam.addColorStop(0, "rgba(255,206,110,.75)"); seam.addColorStop(1, "rgba(255,206,110,.05)");
  x.fillStyle = seam; x.fillRect(cx - W * 0.004, tiers[3][0], W * 0.008, H - tiers[3][0]);
  // crown: tapered gold-framed lantern
  const cb = tiers[3][0], chw = tiers[3][1] * 0.86, ctw = chw * 0.55;
  const cg = x.createLinearGradient(cx - chw, 0, cx + chw, 0); cg.addColorStop(0, "#3a2a10"); cg.addColorStop(0.4, "#c8932f"); cg.addColorStop(0.55, "#ffe08a"); cg.addColorStop(1, "#4a3412");
  x.save(); x.shadowColor = "rgba(255,200,90,.8)"; x.shadowBlur = W * 0.05;
  x.fillStyle = cg; x.beginPath(); x.moveTo(cx - chw, cb); x.lineTo(cx - ctw, crownTop); x.lineTo(cx + ctw, crownTop); x.lineTo(cx + chw, cb); x.closePath(); x.fill(); x.restore();
  // lantern ribs
  x.strokeStyle = "rgba(60,40,10,.55)"; x.lineWidth = Math.max(1, W * 0.004);
  for (let i = -3; i <= 3; i++) { x.beginPath(); x.moveTo(cx + i * chw / 3.5, cb); x.lineTo(cx + i * ctw / 3.5, crownTop); x.stroke(); }
  // halo ring around the crown
  x.save(); x.shadowColor = "rgba(255,210,120,1)"; x.shadowBlur = W * 0.04; x.strokeStyle = "rgba(255,222,150,.9)"; x.lineWidth = Math.max(2, H * 0.003);
  x.beginPath(); x.ellipse(cx, (cb + crownTop) / 2, chw * 1.55, H * 0.012, 0, 0, Math.PI * 2); x.stroke(); x.restore();
  // MJT coin emblem
  const ey = cb + (crownTop - cb) * 0.45, er = chw * 0.55;
  x.fillStyle = "#1a1206"; x.beginPath(); x.arc(cx, ey, er, 0, Math.PI * 2); x.fill();
  x.strokeStyle = "#ffd36b"; x.lineWidth = Math.max(2, er * 0.14); x.beginPath(); x.arc(cx, ey, er * 0.86, 0, Math.PI * 2); x.stroke();
  x.fillStyle = "#ffd36b"; x.font = `800 ${Math.round(er * 0.72)}px sans-serif`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("MJT", cx, ey + er * 0.04);
  // spire + aviation light
  const sg = x.createLinearGradient(0, spireTop, 0, crownTop); sg.addColorStop(0, "#fff1c4"); sg.addColorStop(1, "#c8932f");
  x.fillStyle = sg; x.beginPath(); x.moveTo(cx, spireTop); x.lineTo(cx + W * 0.012, crownTop); x.lineTo(cx - W * 0.012, crownTop); x.closePath(); x.fill();
  x.save(); x.shadowColor = "#ff3b3b"; x.shadowBlur = W * 0.04; x.fillStyle = "#ff5a5a"; x.beginPath(); x.arc(cx, spireTop, Math.max(2, W * 0.008), 0, Math.PI * 2); x.fill(); x.restore();
  return { cv };
}

/* Everything is drawn by the window glass itself: for each pixel a ray from the camera through the glass is intersected
 * with three virtual planes behind the wall (far / mid / near) and the painted layers are composited — true parallax as
 * the player walks, zero cost outside the window, and the city is never visible anywhere but through the glass.
 * Flying cars and rain on the glass are added in the same pass. */
const L = { far: { z: -40, w: 120, h: 60, y: 4 }, mid: { z: -22, w: 70, h: 26.25, y: -9 }, near: { z: -8, w: 24, h: 24, y: -6 }, core: { z: -16, w: 10, h: 34, y: -10 }, cars: -15 };

export function windowMaterial({ hi = true } = {}) {
  const k = hi ? 1 : 0.5;
  const far = farLayer(2048 * k, 1024 * k, 11), mid = midLayer(2048 * k, 768 * k, 29), near = nearLayer(1024 * k, 1024 * k, 47), core = coreLayer(hi ? 768 : 384, hi ? 2600 : 1300);
  const plane = (o) => `vec4(${o.z.toFixed(2)}, ${o.w.toFixed(2)}, ${o.h.toFixed(2)}, ${o.y.toFixed(2)})`;
  return new ShaderMaterial({
    uniforms: { tFar: { value: tex(far.cv) }, tMid: { value: tex(mid.cv) }, tNear: { value: tex(near.cv) }, tCore: { value: tex(core.cv) }, uTime: { value: 0 } },
    vertexShader: "varying vec3 vW; varying vec2 vU; void main(){ vU = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `uniform sampler2D tFar, tMid, tNear, tCore; uniform float uTime; varying vec3 vW; varying vec2 vU;
      float h(float x){ return fract(sin(x * 91.7) * 43758.5); }
      vec2 hit(vec3 rd, vec4 P){ float t = (P.x - cameraPosition.z) / rd.z; vec3 p = cameraPosition + rd * t; return vec2(p.x / P.y + 0.5, (p.y - P.w) / P.z + 0.5); }
      vec4 layer(sampler2D tx, vec2 uv){ if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0); return texture2D(tx, uv); }
      void main(){
        vec3 rd = normalize(vW - cameraPosition);
        vec3 col = texture2D(tFar, clamp(hit(rd, ${plane(L.far)}), 0.001, 0.999)).rgb;
        // flying cars on a plane between far and mid
        float tc = (${L.cars.toFixed(1)} - cameraPosition.z) / rd.z; vec3 pc = cameraPosition + rd * tc;
        for (int i = 0; i < 10; i++) { float fi = float(i); float dir = h(fi * 3.7) < 0.5 ? 1.0 : -1.0; float v = 1.5 + h(fi * 5.3) * 2.5;
          float cx = mod(h(fi) * 56.0 + uTime * v * dir, 56.0) - 28.0; float cy = -3.0 + h(fi * 9.1) * 8.0 + sin(uTime * 0.7 + fi) * 0.15;
          vec2 d = vec2((pc.x - cx) * 0.6, pc.y - cy); float g = exp(-dot(d, d) * 40.0);
          col += (dir > 0.0 ? vec3(1.0, 0.55, 0.2) : vec3(0.25, 0.8, 1.0)) * g * 2.5; }
        vec4 m = layer(tMid, hit(rd, ${plane(L.mid)})); col = mix(col, m.rgb, m.a);
        vec4 cr = layer(tCore, hit(rd, ${plane(L.core)})); col = mix(col, cr.rgb * 1.15, cr.a);
        vec4 n = layer(tNear, hit(rd, ${plane(L.near)})); col = mix(col, n.rgb, n.a);
        col *= 1.15;
        // rain on the glass
        float c = floor(vU.x * 90.0); float sp = 0.15 + h(c) * 0.35; float y = fract(vU.y + uTime * sp + h(c * 3.1));
        float drop = smoothstep(0.0, 0.02, y) * smoothstep(0.08, 0.02, y) * step(0.55, h(c * 7.3)) * smoothstep(0.5, 0.0, abs(fract(vU.x * 90.0) - 0.5));
        col = col * (1.0 - drop * 0.3) + vec3(0.6, 0.75, 1.0) * drop * 0.35;
        // faint glass sheen towards the top
        col += vec3(0.05, 0.07, 0.12) * smoothstep(0.6, 1.0, vU.y);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}
