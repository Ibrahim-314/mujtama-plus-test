/* The prologue's places («الإشارة»), built in Babylon from code and the game's own character models — no new asset files.
 * Each set is a TransformNode at its own far origin (scenes/prologue-shots.js SET_ORIGIN) with its own lights (scoped to
 * its own meshes, so switching sets never recompiles a shader), its own sky, fog and grade (applied by the scene at a cut).
 *
 *   village  a southern mountain village at dawn: terraced slopes, stone tower-houses with slate ledges and white
 *            crenellations, juniper, a winding path, layered ridgelines fading into the haze, drifting valley fog
 *   home     the protagonist's room: whitewashed stone with a painted Asiri «qatt» band, a dawn shaft through the window
 *            with dust, majlis cushions, the father's old radio transceiver on the table, the brass key «40»
 *   train    the magnetic train on its guideway at night; pylons, lamps and far lights stream past (parallax)
 *   city     the Digital City at night: avenues, thousands of towers, landmark silhouettes, the MJT tower at the centre
 *            (bjs/tower.js, the same tower as the street, scaled up) with its light column, haze and low cloud
 *   cabin    inside the train: seats, window bands with passing light, ceiling strips, the route display (the signal)
 *
 * Quality: q = game.renderer.q; `low` builds fewer instances, smaller textures and no particles. */
import { Color3, Vector3, PBRMaterial, StandardMaterial, Texture, DynamicTexture } from "./core.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.js";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.js";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder.js";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder.js";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder.js";
import { ExtrudeShapeCustom } from "@babylonjs/core/Meshes/Builders/shapeBuilder.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem.js";
import "@babylonjs/core/Particles/particleSystemComponent.js";
import { Matrix, Quaternion, Vector4 } from "@babylonjs/core/Maths/math.vector.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { buildTower } from "./tower.js";
import { spawnCharacter } from "./hero.js";

// ---------------------------------------------------------------- shared helpers
const rnd = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z, o = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { s += vnoise(x * f, z * f) * a; n += a; a *= 0.5; f *= 2.03; } return s / n; };
const C = (h) => Color3.FromHexString(h);

/** a canvas texture (sRGB colours drawn by the browser, so Arabic text — not used here on 3D surfaces — would shape too) */
function canvasTex(scene, w, h, draw, { wrap = false, alpha = false, mip = true, name = "ptex" } = {}) {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, mip);
  const x = t.getContext(); x.clearRect(0, 0, w, h); draw(x, w, h); t.update(true);
  t.hasAlpha = alpha; t.wrapU = t.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE; t.anisotropicFilteringLevel = 4;
  return t;
}
function pbr(scene, name, hex, rough, metal, o = {}) { const m = new PBRMaterial(name, scene); m.albedoColor = C(hex); m.roughness = rough; m.metallic = metal; Object.assign(m, o); return m; }
function unlit(scene, name, hex, k = 1, o = {}) {
  const m = new StandardMaterial(name, scene); m.emissiveColor = C(hex).scale(k); m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); m.disableLighting = true; Object.assign(m, o); return m;
}
function additive(scene, name, tex, k = 1, o = {}) {
  const m = new StandardMaterial(name, scene); m.emissiveTexture = tex; m.opacityTexture = tex; m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black();
  m.disableLighting = true; m.alphaMode = Constants.ALPHA_ADD; m.disableDepthWrite = true; m.backFaceCulling = false; m.emissiveColor = new Color3(k, k, k); Object.assign(m, o); return m;
}
/** a box whose faces tile its texture in metres (tile = metres per texture repeat) */
function tiledBox(scene, name, w, h, d, tile) {
  const u = (a) => a / tile;
  const faceUV = [new Vector4(0, 0, u(w), u(h)), new Vector4(0, 0, u(w), u(h)), new Vector4(0, 0, u(d), u(h)), new Vector4(0, 0, u(d), u(h)), new Vector4(0, 0, u(w), u(d)), new Vector4(0, 0, u(w), u(d))];
  return CreateBox(name, { width: w, height: h, depth: d, faceUV, wrap: true }, scene);
}
function radialTex(scene, stops, size = 128, name = "radial") {
  return canvasTex(scene, size, size, (x, w, h) => { const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); for (const [k, c] of stops) g.addColorStop(k, c); x.fillStyle = g; x.fillRect(0, 0, w, h); }, { alpha: true, name });
}
/** a sky gradient for the shared sky dome (row 0 = zenith, the middle row = the horizon, like the street's sky) */
export function skyTexture(scene, stops) {
  return canvasTex(scene, 8, 512, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); for (const [k, c] of stops) g.addColorStop(k, c); x.fillStyle = g; x.fillRect(0, 0, w, h); }, { name: "skyGrad" });
}
const matrixAt = (x, y, z, sx, sy, sz, ry = 0) => Matrix.Compose(new Vector3(sx, sy, sz), Quaternion.RotationYawPitchRoll(ry, 0, 0), new Vector3(x, y, z));
function thin(mesh, mats) {
  const buf = new Float32Array(mats.length * 16); mats.forEach((m, i) => m.copyToArray(buf, i * 16));
  mesh.thinInstanceSetBuffer("matrix", buf, 16, true); mesh.thinInstanceRefreshBoundingInfo(false); return mesh;
}
function merge(list, name) {
  if (!list.length) return null;
  const m = Mesh.MergeMeshes(list, true, true, undefined, false, false); if (m) { m.name = name; m.isPickable = false; } return m;
}
/** after a set is built: its lights touch only its own meshes, its meshes stop being pickable */
function scope(root, lights) {
  const meshes = root.getChildMeshes(false);
  for (const m of meshes) {
    m.isPickable = false;
    const mat = m.material; if (!mat) continue;
    if (lights.length > 4) mat.maxSimultaneousLights = lights.length;
    if (m.getTotalVertices?.() === 4) mat.backFaceCulling = false; // a plane reads from both sides in the right-handed scene
  }
  for (const l of lights) l.includedOnlyMeshes = meshes;
}

// ---------------------------------------------------------------- 1 · the mountain village at dawn
const VC = { x: 15, z: 0 };             // the village centre
export const HOME_HOUSE = { x: 16, z: 18 }; // the protagonist's house, at the edge facing the valley
function villageHeight(x, z) {
  const d = Math.hypot(x - VC.x, z - VC.z);
  let h = 22 + sstep(-30, -280, z) * 120 - sstep(55, 270, z) * 62 + sstep(140, 330, Math.abs(x - 10)) * 46;
  h += (fbm(x / 95 + 3.1, z / 95 - 1.7, 5) - 0.5) * 70 * sstep(35, 150, d);
  h += (fbm(x / 18, z / 18, 2) - 0.5) * 3.2 * sstep(20, 60, d);
  // terraces on the slopes around the village (soft steps, 2.4 m apart)
  const tm = sstep(28, 48, d) * (1 - sstep(120, 170, d)) * (1 - sstep(-10, -70, z) * 0.7);
  if (tm > 0) { const q = h / 2.4, f = q - Math.floor(q); h += ((Math.floor(q) + sstep(0.72, 1, f)) * 2.4 - h) * tm; }
  // the village sits on a shoulder of the mountain
  const flat = 1 - sstep(26, 46, d);
  return h + (22.4 + (fbm(x / 12, z / 12, 2) - 0.5) * 1.2 - h) * flat;
}
const PATH = [[16, 22], [10, 40], [-6, 58], [-14, 80], [-4, 104], [-22, 130], [-40, 160], [-36, 200], [-58, 240]];
function pathDist(x, z) {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

function stoneTexture(scene, size, seed, base = [118, 104, 88]) {
  const R = rnd(seed);
  return canvasTex(scene, size, size, (x, w, h) => {
    x.fillStyle = `rgb(${base[0] - 30},${base[1] - 28},${base[2] - 24})`; x.fillRect(0, 0, w, h);
    const rows = 9, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let cx = -R() * 40;
      while (cx < w) {
        const sw = 30 + R() * 46, k = 0.78 + R() * 0.4, tint = R() * 14 - 7;
        x.fillStyle = `rgb(${(base[0] * k + tint) | 0},${(base[1] * k + tint * 0.6) | 0},${(base[2] * k) | 0})`;
        x.fillRect(cx + 2, r * rh + 2, sw - 3, rh - 3);
        x.fillStyle = "rgba(255,240,220,0.06)"; x.fillRect(cx + 2, r * rh + 2, sw - 3, 3);
        cx += sw;
      }
    }
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(0,0,0,${R() * 0.12})`; x.fillRect(R() * w, R() * h, 2, 2); }
  }, { wrap: true, name: "stone" });
}

export async function buildVillage(scene, origin, { low, high }) {
  const root = new TransformNode("set-village", scene); root.position.set(...origin);
  const R = rnd(1977);
  // light: a low sun from the east breaking over the ridge, a cool sky fill
  const SUN = new Vector3(-0.86, -0.2, 0.47).normalize();
  const sun = new DirectionalLight("vSun", SUN, scene); sun.position = SUN.scale(-300).addInPlace(root.position); sun.diffuse = C("#ffb57c"); sun.intensity = 2.5;
  const hemi = new HemisphericLight("vSky", new Vector3(0, 1, 0), scene); hemi.diffuse = C("#8f9fc8"); hemi.groundColor = C("#4a3a34"); hemi.intensity = 0.62;

  // ---- terrain (600 m square), coloured by vertex: terraces, scrub, rock, the path ----
  const S = low ? 120 : 190;
  const ground = CreateGround("vTerrain", { width: 640, height: 640, subdivisions: S, updatable: true }, scene);
  ground.parent = root; ground.position.set(0, 0, -40);
  const pos = ground.getVerticesData(VertexBuffer.PositionKind), idx = ground.getIndices();
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = villageHeight(pos[i], pos[i + 2] - 40);
  const nrm = []; VertexData.ComputeNormals(pos, idx, nrm);
  const col = new Float32Array((pos.length / 3) * 4);
  for (let i = 0, v = 0; i < pos.length; i += 3, v += 4) {
    const x = pos[i], z = pos[i + 2] - 40, y = pos[i + 1], ny = nrm[i + 1], d = Math.hypot(x - VC.x, z - VC.z);
    const n = fbm(x / 7, z / 7, 2), step = Math.floor(y / 2.4);
    // scrub and dry grass, warmer low down; terraces alternate ochre fields and green barley
    let c = [0.36 + n * 0.12, 0.33 + n * 0.1, 0.22 + n * 0.06];
    const terr = sstep(28, 48, d) * (1 - sstep(120, 170, d));
    if (terr > 0.3 && ny > 0.8) c = step % 3 === 0 ? [0.42 + n * 0.08, 0.37, 0.2] : step % 3 === 1 ? [0.3, 0.36 + n * 0.08, 0.18] : [0.36, 0.33 + n * 0.06, 0.21];
    const rock = 1 - sstep(0.55, 0.82, ny); c = c.map((k, j) => k * (1 - rock) + [0.38, 0.35, 0.33][j] * (0.85 + n * 0.3) * rock);
    if (d < 40) c = c.map((k, j) => k * 0.5 + [0.44, 0.38, 0.3][j] * 0.5); // the village's beaten earth
    const pd = pathDist(x, z); if (pd < 2.4) { const k = 1 - sstep(1.2, 2.4, pd); c = c.map((q, j) => q * (1 - k) + [0.6, 0.53, 0.42][j] * k); }
    const ao = 0.75 + 0.25 * ny; col[v] = c[0] * ao; col[v + 1] = c[1] * ao; col[v + 2] = c[2] * ao; col[v + 3] = 1;
  }
  ground.setVerticesData(VertexBuffer.PositionKind, pos); ground.setVerticesData(VertexBuffer.NormalKind, nrm); ground.setVerticesData(VertexBuffer.ColorKind, col);
  ground.refreshBoundingInfo();
  const groundM = new StandardMaterial("vGroundM", scene); groundM.specularColor = Color3.Black(); groundM.diffuseColor = Color3.White(); ground.material = groundM; ground.freezeWorldMatrix();
  const H = (x, z) => villageHeight(x, z);

  // ---- layered ridgelines behind, each one paler (atmospheric perspective) ----
  const ridges = [[-520, 150, 300, "#4f4656", "#9b7f86"], [-820, 230, 420, "#6b5c6c", "#b48f8e"], [-1180, 300, 520, "#8a7480", "#c9a197"], [-1650, 380, 640, "#a88c90", "#d9b2a0"]];
  ridges.forEach(([z, lo, hi, top, haze], k) => {
    const n = 90, P = [], I = [], Cc = [], ct = C(top), ch = C(haze);
    for (let i = 0; i <= n; i++) {
      const x = -2400 + (4800 * i) / n, y = lo + (hi - lo) * fbm(i / 9 + k * 7.3, k * 3.1, 4) + Math.sin(i * 0.37 + k) * 18;
      P.push(x, y, z, x, -60, z); Cc.push(ct.r, ct.g, ct.b, 1, ch.r, ch.g, ch.b, 1);
      if (i < n) { const a = i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const m = new Mesh("ridge" + k, scene); const vd = new VertexData(); const N = []; VertexData.ComputeNormals(P, I, N); vd.positions = P; vd.indices = I; vd.normals = N; vd.colors = Cc; vd.applyToMesh(m);
    const mat = new StandardMaterial("ridgeM" + k, scene); mat.disableLighting = true; mat.diffuseColor = Color3.Black(); mat.emissiveColor = Color3.White(); mat.specularColor = Color3.Black(); mat.fogEnabled = false; mat.backFaceCulling = false;
    m.material = mat; m.parent = root; m.freezeWorldMatrix();
  });

  // ---- stone tower-houses: slate ledges at each floor, white crenellations, small windows ----
  const stoneM = pbr(scene, "vStone", "#ffffff", 0.92, 0, { albedoTexture: stoneTexture(scene, low ? 256 : 512, 11) });
  const slateM = pbr(scene, "vSlate", "#3d3a3a", 0.8, 0.05);
  const limeM = pbr(scene, "vLime", "#efe9dd", 0.85, 0);
  const winDarkM = pbr(scene, "vWinDark", "#121010", 0.5, 0);
  const winLitM = unlit(scene, "vWinLit", "#ffb46a", 1.6);
  const parts = { stone: [], slate: [], lime: [], dark: [], lit: [] };
  const houses = [];
  const corridor = (x, z) => { // keep the camera's way down to the home house clear
    const ax = 4, az = 58, bx = HOME_HOUSE.x, bz = HOME_HOUSE.z + 4, dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - ax - dx * t, z - az - dz * t);
  };
  const tryHouse = (x, z, w, d, fl, ry, home = false) => {
    if (!home && (corridor(x, z) < 9 || houses.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r + Math.max(w, d) * 0.62)))) return false;
    houses.push({ x, z, r: Math.max(w, d) * 0.62 });
    const g = Math.min(H(x - w / 2, z - d / 2), H(x + w / 2, z - d / 2), H(x - w / 2, z + d / 2), H(x + w / 2, z + d / 2));
    const fh = 3.1, ht = fl * fh, base = g - 3, node = new TransformNode("house", scene); node.parent = root; node.position.set(x, 0, z); node.rotation.y = ry;
    const add = (list, m) => { m.parent = node; list.push(m); };
    const body = tiledBox(scene, "hBody", w, ht + 3, d, 3.2); body.position.y = base + (ht + 3) / 2; add(parts.stone, body);
    for (let f = 1; f <= fl; f++) { const s = CreateBox("hLedge", { width: w + 0.34, height: 0.14, depth: d + 0.34 }, scene); s.position.y = g + f * fh - 0.05; add(parts.slate, s); }
    const rim = CreateBox("hRim", { width: w + 0.1, height: 0.42, depth: d + 0.1 }, scene); rim.position.y = g + ht + 0.2; add(parts.lime, rim);
    const merl = Math.max(3, Math.round(w / 1.2));
    for (const sz of [-1, 1]) for (let i = 0; i < merl; i++) { // the white stepped crenellations along the front and back
      const m = CreateBox("hMerlon", { width: 0.34, height: 0.55, depth: 0.12 }, scene); m.position.set(-w / 2 + (i + 0.5) * (w / merl), g + ht + 0.68, sz * (d / 2 + 0.02)); add(parts.lime, m);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const m = CreateBox("hHorn", { width: 0.45, height: 0.9, depth: 0.45 }, scene); m.position.set(sx * (w / 2 - 0.1), g + ht + 0.85, sz * (d / 2 - 0.1)); add(parts.lime, m); }
    // windows on the front (+z) and the sides: white frame, dark or lamp-lit glass
    for (let f = 0; f < fl; f++) {
      const nW = Math.max(1, Math.floor(w / 2.4));
      for (let i = 0; i < nW; i++) {
        const lit = home ? f === 0 && i === 0 : R() < (f === 0 ? 0.22 : 0.08);
        const wx = -w / 2 + (i + 0.5) * (w / nW), wy = g + f * fh + 1.55;
        const fr = CreateBox("hFrame", { width: 0.82, height: 1.02, depth: 0.08 }, scene); fr.position.set(wx, wy, d / 2 + 0.03); add(parts.lime, fr);
        const gl = CreatePlane("hGlass", { width: 0.6, height: 0.8 }, scene); gl.position.set(wx, wy, d / 2 + 0.075); gl.rotation.y = Math.PI; add(lit ? parts.lit : parts.dark, gl);
      }
    }
    if (home) { // the home: a carved door with a lamp beside it
      const dr = CreateBox("hDoor", { width: 1.1, height: 2.1, depth: 0.1 }, scene); dr.position.set(w / 2 - 1.4, g + 1.05, d / 2 + 0.04); add(parts.dark, dr);
      const df = CreateBox("hDoorFrame", { width: 1.4, height: 2.35, depth: 0.06 }, scene); df.position.set(w / 2 - 1.4, g + 1.18, d / 2 + 0.015); add(parts.lime, df);
    }
    return true;
  };
  tryHouse(HOME_HOUSE.x, HOME_HOUSE.z, 6.4, 5.8, 2, -0.12, true);
  const nHouses = low ? 18 : 30;
  for (let tries = 0; houses.length < nHouses && tries < 600; tries++) {
    const a = R() * Math.PI * 2, rr = 6 + Math.pow(R(), 0.7) * 30, x = VC.x + Math.cos(a) * rr, z = VC.z + Math.sin(a) * rr * 0.85 - 3;
    const w = 5 + R() * 3.4, d = 4.6 + R() * 3, fl = R() < 0.25 ? 4 : R() < 0.6 ? 3 : 2;
    tryHouse(x, z, w, d, fl, (R() - 0.5) * 0.5 + (R() < 0.3 ? Math.PI / 2 : 0));
  }
  // a few farmsteads on the terraces
  for (let tries = 0; houses.length < nHouses + (low ? 4 : 9) && tries < 400; tries++) {
    const a = R() * Math.PI * 2, rr = 55 + R() * 70, x = VC.x + Math.cos(a) * rr, z = VC.z + Math.sin(a) * rr;
    if (z < -60) continue; tryHouse(x, z, 4.4 + R() * 2, 4 + R() * 2, R() < 0.5 ? 2 : 1, R() * 0.6 - 0.3);
  }
  for (const k of Object.keys(parts)) {
    const m = merge(parts[k], "vHouses-" + k); if (!m) continue;
    m.parent = root; m.material = { stone: stoneM, slate: slateM, lime: limeM, dark: winDarkM, lit: winLitM }[k]; m.freezeWorldMatrix();
  }

  // ---- juniper on the slopes ----
  const tree = CreateCylinder("juniper", { diameterTop: 0.15, diameterBottom: 2, height: 2, tessellation: 7 }, scene); tree.parent = root;
  tree.material = pbr(scene, "vJuniper", "#1f2a1a", 0.95, 0);
  const tm = [];
  for (let i = 0, n = low ? 140 : 320; tm.length < n && i < n * 6; i++) {
    const x = -260 + R() * 540, z = -250 + R() * 470, d = Math.hypot(x - VC.x, z - VC.z);
    if (d < 34 || pathDist(x, z) < 3 || corridor(x, z) < 12 || Math.hypot(x + 62, z - 118) < 30) continue;
    if (fbm(x / 60, z / 60, 2) < 0.48 && d > 60) continue; // clumps
    const s = 1.4 + R() * 2.2, y = H(x, z);
    const sy = s * (1.3 + R() * 0.7); tm.push(matrixAt(x, y + sy * 0.85, z, s, sy, s, R() * 6));
  }
  thin(tree, tm);

  // ---- valley fog and morning haze drifting over the slopes ----
  const fogTex = canvasTex(scene, 256, 256, (x, w, h) => {
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const n = fbm(i / 38, j / 38, 4), e = Math.min(1, Math.min(i, w - i, j, h - j) / 60), a = Math.max(0, n - 0.42) * 1.9 * e;
      const k = (j * w + i) * 4; img.data[k] = 255; img.data[k + 1] = 236; img.data[k + 2] = 222; img.data[k + 3] = Math.min(255, a * 255);
    }
    x.putImageData(img, 0, 0);
  }, { alpha: true, name: "vFogTex" });
  const fogs = [];
  const fogLayers = low ? [[-6, 420, 0.55], [14, 260, 0.35]] : [[-14, 520, 0.5], [-2, 420, 0.55], [12, 300, 0.4], [26, 240, 0.22]];
  fogLayers.forEach(([y, size, a], i) => {
    const m = new StandardMaterial("vFogM" + i, scene); m.diffuseTexture = fogTex; m.opacityTexture = fogTex; m.emissiveColor = C("#5e4c4a"); m.diffuseColor = C("#ffd9c4");
    m.specularColor = Color3.Black(); m.alpha = a; m.disableDepthWrite = true; m.backFaceCulling = false; m.useAlphaFromDiffuseTexture = false;
    const p = CreateGround("vFog" + i, { width: size, height: size }, scene); p.parent = root; p.position.set(-30 + i * 22, y, 120 - i * 30); p.material = m; p.rotation.y = i * 0.7;
    fogs.push({ m, sp: 0.004 + i * 0.002 });
  });

  // ---- the sun: a disc behind the haze, on the line of the light ----
  const sunTex = radialTex(scene, [[0, "rgba(255,246,220,1)"], [0.12, "rgba(255,214,150,0.95)"], [0.4, "rgba(255,160,110,0.28)"], [1, "rgba(255,140,110,0)"]], 256, "vSunTex");
  const sunDisc = CreateDisc("vSunDisc", { radius: 60, tessellation: 40 }, scene); sunDisc.material = additive(scene, "vSunM", sunTex, 1, { fogEnabled: false });
  sunDisc.billboardMode = Mesh.BILLBOARDMODE_ALL; sunDisc.parent = root; sunDisc.position.copyFrom(SUN.scale(-1500)); sunDisc.position.y = 140;

  scope(root, [sun, hemi]);
  return {
    root, name: "village",
    look: { clear: "#c49a92", fog: "#cfa497", fogDensity: low ? 0.0024 : 0.0021, env: 0.5, exposure: 1.05, contrast: 1.15, glow: 0.45,
      sky: [[0, "#2b3f68"], [0.3, "#59709f"], [0.44, "#c99a9a"], [0.49, "#f1b98f"], [0.5, "#ffd2a0"], [0.56, "#b48b88"], [1, "#5a4a4c"]] },
    update(dt, t) { for (const f of fogs) { f.m.diffuseTexture.uOffset += f.sp * dt; f.m.diffuseTexture.vOffset += f.sp * 0.4 * dt; } }
  };
}

// ---------------------------------------------------------------- 2 · the home and the old device
export const DEVICE_AT = new Vector3(0.1, 0.93, -1.3), KEY_AT = new Vector3(0.52, 0.8, -0.86);
function qattBand(scene) { // the painted Asiri band: rows of triangles and stripes in ochre, green, indigo and red
  return canvasTex(scene, 1024, 128, (x, w, h) => {
    x.fillStyle = "#e9dfcd"; x.fillRect(0, 0, w, h);
    const cols = ["#b5452f", "#2f6b48", "#d39a2c", "#2e3f7a"];
    x.fillStyle = "#2a2422"; x.fillRect(0, 8, w, 6); x.fillRect(0, h - 14, w, 6);
    for (let i = 0; i < 32; i++) {
      x.fillStyle = cols[i % 4]; x.beginPath(); x.moveTo(i * 32, 20); x.lineTo(i * 32 + 32, 20); x.lineTo(i * 32 + 16, 64); x.closePath(); x.fill();
      x.fillStyle = cols[(i + 2) % 4]; x.beginPath(); x.moveTo(i * 32 + 16, 64); x.lineTo(i * 32 + 32, 108); x.lineTo(i * 32, 108); x.closePath(); x.fill();
    }
    x.fillStyle = "#2a2422"; for (let i = 0; i < 64; i++) x.fillRect(i * 16 + 6, 62, 4, 4);
  }, { wrap: true, name: "qatt" });
}
function plasterTex(scene, size) {
  const R = rnd(5);
  return canvasTex(scene, size, size, (x, w, h) => {
    x.fillStyle = "#ddd3c3"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const a = R() * 0.07; x.fillStyle = R() < 0.5 ? `rgba(120,96,70,${a})` : `rgba(255,250,240,${a})`; const s = 2 + R() * 14; x.fillRect(R() * w, R() * h, s, s * (0.4 + R())); }
    const g = x.createLinearGradient(0, h * 0.75, 0, h); g.addColorStop(0, "rgba(90,70,50,0)"); g.addColorStop(1, "rgba(90,70,50,0.22)"); x.fillStyle = g; x.fillRect(0, 0, w, h);
  }, { wrap: true, name: "plaster" });
}
function woodTex(scene, size, dark = false) {
  const R = rnd(dark ? 9 : 3);
  return canvasTex(scene, size, size, (x, w, h) => {
    const planks = 6, ph = h / planks;
    for (let p = 0; p < planks; p++) {
      const k = 0.85 + R() * 0.3; x.fillStyle = dark ? `rgb(${(58 * k) | 0},${(40 * k) | 0},${(28 * k) | 0})` : `rgb(${(122 * k) | 0},${(88 * k) | 0},${(58 * k) | 0})`; x.fillRect(0, p * ph, w, ph);
      for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(30,18,10,${0.08 + R() * 0.12})`; x.beginPath(); const y = p * ph + R() * ph; x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + R() * 8 - 4, w * 0.7, y + R() * 8 - 4, w, y + R() * 6 - 3); x.stroke(); }
      x.fillStyle = "rgba(0,0,0,0.45)"; x.fillRect(0, p * ph, w, 2);
    }
  }, { wrap: true, name: "wood" });
}
function grimeTex(scene, base, size = 256) {
  const R = rnd(31);
  return canvasTex(scene, size, size, (x, w, h) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { x.strokeStyle = `rgba(230,220,200,${R() * 0.12})`; x.lineWidth = 0.6; x.beginPath(); const sx = R() * w, sy = R() * h; x.moveTo(sx, sy); x.lineTo(sx + R() * 30 - 15, sy + R() * 6 - 3); x.stroke(); }
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(190,170,140,${R() * 0.1})`; x.fillRect(R() * w, R() * h, 1.5, 1.5); } // dust
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(200,180,150,0.18)"); g.addColorStop(0.4, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h);
  }, { name: "grime" });
}
function keyTexture(scene) { // brass with a worn patina and «40» struck into the bow
  const R = rnd(40);
  return canvasTex(scene, 256, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#c9a25a"); g.addColorStop(0.5, "#a77d38"); g.addColorStop(1, "#c79c50"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { x.fillStyle = R() < 0.6 ? `rgba(60,40,15,${R() * 0.2})` : `rgba(70,110,80,${R() * 0.09})`; x.fillRect(R() * w, R() * h, 2 + R() * 4, 2 + R() * 4); }
    x.font = "800 150px Georgia, 'Times New Roman', serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = "rgba(255,230,170,0.35)"; x.fillText("40", w / 2 + 3, h / 2 + 5); x.fillStyle = "#3b2810"; x.fillText("40", w / 2, h / 2);
  }, { name: "keyTex" });
}

/** the brass key: bow with «40», collar, shaft, bit. ~15 cm. Returns its root (local +x = along the shaft). */
export function makeKey(scene, parent) {
  const k = new TransformNode("brassKey", scene); k.parent = parent;
  const brass = pbr(scene, "brass", "#e2b866", 0.3, 1, { environmentIntensity: 1.4 });
  const face = pbr(scene, "brassFace", "#ffffff", 0.36, 1, { albedoTexture: keyTexture(scene), environmentIntensity: 1.3 });
  const bow = CreateTorus("keyBow", { diameter: 0.05, thickness: 0.011, tessellation: 40 }, scene); bow.material = brass; bow.parent = k; bow.rotation.x = Math.PI / 2;
  const disc = CreateCylinder("keyDisc", { diameter: 0.042, height: 0.004, tessellation: 36, faceUV: [new Vector4(0, 0, 1, 1), new Vector4(0, 0, 0.01, 0.01), new Vector4(0, 0, 1, 1)] }, scene);
  disc.material = face; disc.parent = k; disc.rotation.x = Math.PI / 2; disc.rotation.y = 0;
  for (const [x, d] of [[0.03, 0.017], [0.036, 0.014]]) { const c = CreateTorus("keyCollar", { diameter: d, thickness: 0.005, tessellation: 20 }, scene); c.material = brass; c.parent = k; c.rotation.z = Math.PI / 2; c.position.x = x; }
  const shaft = CreateCylinder("keyShaft", { diameter: 0.0085, height: 0.1, tessellation: 18 }, scene); shaft.material = brass; shaft.parent = k; shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.083;
  for (const [x, y, w, hh] of [[0.118, -0.009, 0.008, 0.014], [0.128, -0.012, 0.006, 0.02], [0.126, -0.006, 0.014, 0.006]]) { const b = CreateBox("keyBit", { width: w, height: hh, depth: 0.004 }, scene); b.material = brass; b.parent = k; b.position.set(x, y, 0); }
  return { root: k, meshes: k.getChildMeshes(false) };
}

export async function buildHome(scene, origin, { low, high, models, heroUrl, momUrl }) {
  const root = new TransformNode("set-home", scene); root.position.set(...origin);
  const o = root.position;
  const W = 3, D = 2.5, HT = 2.9, T = 0.25;
  const plaster = pbr(scene, "hPlaster", "#ffffff", 0.95, 0, { albedoTexture: plasterTex(scene, low ? 256 : 512) });
  plaster.albedoTexture.uScale = 2; plaster.albedoTexture.vScale = 1;
  const band = pbr(scene, "hQatt", "#ffffff", 0.9, 0, { albedoTexture: qattBand(scene) });
  const floorM = pbr(scene, "hFloor", "#ffffff", 0.82, 0, { albedoTexture: woodTex(scene, low ? 256 : 512) }); floorM.albedoTexture.uScale = 3; floorM.albedoTexture.vScale = 3;
  const beamM = pbr(scene, "hBeam", "#ffffff", 0.9, 0, { albedoTexture: woodTex(scene, 256, true) });
  const casters = [];
  const box = (nm, w, h, d, x, y, z, mat, cast = true) => { const m = CreateBox(nm, { width: w, height: h, depth: d }, scene); m.parent = root; m.position.set(x, y, z); m.material = mat; m.receiveShadows = true; if (cast) casters.push(m); return m; };

  // room shell: floor, ceiling with beams, walls (the back wall has the window, the right wall the door)
  const floor = CreateGround("hFloorG", { width: W * 2, height: D * 2 }, scene); floor.parent = root; floor.material = floorM; floor.receiveShadows = true;
  box("hCeil", W * 2 + 0.5, 0.12, D * 2 + 0.5, 0, HT + 0.06, 0, beamM, false);
  for (let x = -2.6; x <= 2.7; x += 0.75) box("hBeamX", 0.16, 0.16, D * 2, x, HT - 0.08, 0, beamM, false);
  const WIN = { x0: -0.5, x1: 0.75, y0: 1.08, y1: 2.0 }, DOOR = { z0: 0.45, z1: 1.55, h: 2.1 };
  // back wall z = -D with the window opening
  box("hWB1", W * 2, WIN.y0, T, 0, WIN.y0 / 2, -D - T / 2, plaster);
  box("hWB2", W * 2, HT - WIN.y1, T, 0, (HT + WIN.y1) / 2, -D - T / 2, plaster);
  box("hWB3", WIN.x0 + W, WIN.y1 - WIN.y0, T, (-W + WIN.x0) / 2, (WIN.y0 + WIN.y1) / 2, -D - T / 2, plaster);
  box("hWB4", W - WIN.x1, WIN.y1 - WIN.y0, T, (W + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, -D - T / 2, plaster);
  box("hWF", -WIN.x0 + WIN.x1 + 0.12, 0.08, 0.32, (WIN.x0 + WIN.x1) / 2, WIN.y0 - 0.02, -D - 0.02, beamM); // sill
  box("hWLin", -WIN.x0 + WIN.x1 + 0.3, 0.12, 0.32, (WIN.x0 + WIN.x1) / 2, WIN.y1 + 0.06, -D - 0.02, beamM); // lintel
  for (const s of [-1, 1]) { const sh = box("hShutter", 0.62, 0.92, 0.04, s < 0 ? WIN.x0 - 0.05 : WIN.x1 + 0.05, (WIN.y0 + WIN.y1) / 2, -D + 0.28, beamM); sh.rotation.y = s * 1.15; sh.position.x += s * 0.22; }
  box("hWL", T, HT, D * 2, -W - T / 2, HT / 2, 0, plaster);
  box("hWF2", W * 2, HT, T, 0, HT / 2, D + T / 2, plaster, false);
  // right wall x = +W with the door
  box("hWR1", T, HT, DOOR.z0 + D, W + T / 2, HT / 2, (-D + DOOR.z0) / 2, plaster);
  box("hWR2", T, HT, D - DOOR.z1, W + T / 2, HT / 2, (D + DOOR.z1) / 2, plaster);
  box("hWR3", T, HT - DOOR.h, DOOR.z1 - DOOR.z0, W + T / 2, (HT + DOOR.h) / 2, (DOOR.z0 + DOOR.z1) / 2, plaster);
  // the qatt band around the walls at eye level
  for (const [w, x, z, ry] of [[W * 2, 0, -D + 0.005, 0], [D * 2, -W + 0.005, 0, Math.PI / 2], [D * 2, W - 0.005, 0, -Math.PI / 2], [W * 2, 0, D - 0.005, Math.PI]]) {
    const p = CreatePlane("hBand", { width: w, height: 0.3 }, scene); p.parent = root; p.material = band; p.position.set(x, 2.25, z); p.rotation.y = ry + Math.PI; p.receiveShadows = true;
    if (Math.abs(ry) < 0.1 && z < 0) { p.dispose(); for (const [ww, xx] of [[WIN.x0 + W, (-W + WIN.x0) / 2], [W - WIN.x1, (W + WIN.x1) / 2]]) { const q = CreatePlane("hBand", { width: ww, height: 0.3 }, scene); q.parent = root; q.material = band; q.position.set(xx, 2.25, z); q.rotation.y = Math.PI; q.receiveShadows = true; } }
  }
  // outside: the dawn beyond the window and the door (bright, so the room reads as lit from outside)
  const dawnTex = canvasTex(scene, 64, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#9fb3d8"); g.addColorStop(0.55, "#ffd7a8"); g.addColorStop(0.7, "#f3b886"); g.addColorStop(0.72, "#6d5a58"); g.addColorStop(1, "#4b3f3f"); x.fillStyle = g; x.fillRect(0, 0, w, h); }, { name: "dawnTex" });
  const out1 = CreatePlane("hOutWin", { width: 4, height: 2.6 }, scene); out1.parent = root; out1.position.set(0.1, 1.6, -D - 1.6); out1.rotation.y = Math.PI;
  const outM = new StandardMaterial("hOutM", scene); outM.emissiveTexture = dawnTex; outM.disableLighting = true; outM.diffuseColor = Color3.Black(); outM.specularColor = Color3.Black(); dawnTex.level = 0.95; outM.fogEnabled = false; out1.material = outM;
  const out2 = CreatePlane("hOutDoor", { width: 3, height: 3 }, scene); out2.parent = root; out2.position.set(W + 1.2, 1.3, (DOOR.z0 + DOOR.z1) / 2); out2.rotation.y = -Math.PI / 2; out2.material = outM;

  // furniture: a low table, a stool, majlis cushions along the left wall, a rug, a shelf with jars, a lantern
  const tableM = pbr(scene, "hTable", "#ffffff", 0.75, 0, { albedoTexture: woodTex(scene, 256, true) });
  box("hTop", 1.4, 0.06, 0.8, 0.2, 0.77, -1.2, tableM);
  for (const [x, z] of [[-0.42, -1.52], [0.82, -1.52], [-0.42, -0.88], [0.82, -0.88]]) box("hLeg", 0.06, 0.74, 0.06, x, 0.37, z, tableM);
  box("hStool", 0.42, 0.45, 0.42, -2.3, 0.225, -1.9, tableM);
  const rugTex = canvasTex(scene, 512, 256, (x, w, h) => {
    x.fillStyle = "#7a2421"; x.fillRect(0, 0, w, h); x.strokeStyle = "#d8a24a"; x.lineWidth = 10; x.strokeRect(14, 14, w - 28, h - 28);
    x.fillStyle = "#1f2c4c"; for (let i = 0; i < 7; i++) { x.beginPath(); const cx = 60 + i * 65; x.moveTo(cx, h / 2 - 40); x.lineTo(cx + 26, h / 2); x.lineTo(cx, h / 2 + 40); x.lineTo(cx - 26, h / 2); x.closePath(); x.fill(); }
    x.fillStyle = "#e6d4b0"; for (let i = 0; i < 24; i++) x.fillRect(30 + i * 19, 30, 6, 6);
  }, { name: "rug" });
  const rug = CreateGround("hRug", { width: 2.6, height: 1.5 }, scene); rug.parent = root; rug.position.set(-0.6, 0.006, 0.6); rug.material = pbr(scene, "hRugM", "#ffffff", 1, 0, { albedoTexture: rugTex }); rug.receiveShadows = true;
  const cushTex = canvasTex(scene, 256, 64, (x, w, h) => { x.fillStyle = "#8c2a24"; x.fillRect(0, 0, w, h); x.fillStyle = "#d8a24a"; for (let i = 0; i < 16; i++) x.fillRect(i * 16, 26, 8, 12); x.fillStyle = "#24345a"; x.fillRect(0, 0, w, 6); x.fillRect(0, h - 6, w, 6); }, { wrap: true, name: "cush" });
  const cushM = pbr(scene, "hCush", "#ffffff", 0.95, 0, { albedoTexture: cushTex });
  box("hSeat", 0.7, 0.26, 4.4, -W + 0.4, 0.13, 0.1, cushM); box("hBack", 0.22, 0.5, 4.4, -W + 0.12, 0.5, 0.1, cushM);
  box("hShelf", 1.2, 0.05, 0.28, -1.6, 1.62, -D + 0.16, beamM);
  const jarM = pbr(scene, "hJar", "#9b6a44", 0.7, 0);
  for (const [x, h, d] of [[-2.05, 0.26, 0.18], [-1.78, 0.18, 0.14], [-1.5, 0.3, 0.2], [-1.2, 0.2, 0.15]]) { const j = CreateCylinder("hJar", { diameterTop: d * 0.55, diameterBottom: d * 0.8, height: h, tessellation: 20 }, scene); j.parent = root; j.material = jarM; j.position.set(x, 1.645 + h / 2, -D + 0.16); casters.push(j); }
  const lantern = CreateCylinder("hLantern", { diameterTop: 0.1, diameterBottom: 0.16, height: 0.24, tessellation: 8 }, scene); lantern.parent = root; lantern.position.set(-1.2, 2.45, 0.6); lantern.material = pbr(scene, "hLanternM", "#b98a46", 0.4, 1);
  const lanternGlow = CreateIcoSphere("hFlame", { radius: 0.035, subdivisions: 1 }, scene); lanternGlow.parent = root; lanternGlow.position.set(-1.2, 2.42, 0.6); lanternGlow.material = unlit(scene, "hFlameM", "#ffb24d", 2.2);

  // ---- the device: a field radio transceiver from before the blackout, ten years of dust on it ----
  const dev = new TransformNode("device", scene); dev.parent = root; dev.position.copyFrom(DEVICE_AT); dev.rotation.y = 0.18;
  const bodyM = pbr(scene, "dBody", "#ffffff", 0.62, 0.35, { albedoTexture: grimeTex(scene, "#4d5240") });
  const panelM = pbr(scene, "dPanel", "#ffffff", 0.7, 0.2, { albedoTexture: grimeTex(scene, "#2a2a28") });
  const chromeM = pbr(scene, "dChrome", "#c8c8c4", 0.32, 1);
  const knobM = pbr(scene, "dKnob", "#1b1a19", 0.45, 0);
  const part = (nm, w, h, d, x, y, z, m) => { const b = CreateBox(nm, { width: w, height: h, depth: d }, scene); b.parent = dev; b.position.set(x, y, z); b.material = m; b.receiveShadows = true; casters.push(b); return b; };
  part("dCase", 0.5, 0.26, 0.27, 0, 0, 0, bodyM);
  part("dFace", 0.47, 0.23, 0.01, 0, 0, 0.137, panelM);
  for (const sx of [-1, 1]) { part("dRail", 0.02, 0.27, 0.29, sx * 0.255, 0, 0, chromeM); part("dFoot", 0.06, 0.012, 0.25, sx * 0.19, -0.136, 0, knobM); }
  const grille = canvasTex(scene, 128, 128, (x, w, h) => { x.fillStyle = "#1c1c1a"; x.fillRect(0, 0, w, h); x.fillStyle = "#050505"; for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) { x.beginPath(); x.arc(6 + i * 10.4, 6 + j * 10.4, 3.2, 0, 7); x.fill(); } }, { name: "grille" });
  const gr = CreatePlane("dGrille", { width: 0.15, height: 0.15 }, scene); gr.parent = dev; gr.position.set(-0.14, -0.01, 0.1431); gr.rotation.y = Math.PI; gr.material = pbr(scene, "dGrilleM", "#ffffff", 0.8, 0.3, { albedoTexture: grille });
  // the screen: dark glass until the signal wakes it
  const scr = new DynamicTexture("dScreen", { width: 512, height: 256 }, scene, true); const sx = scr.getContext();
  const scrM = new StandardMaterial("dScreenM", scene); scrM.emissiveTexture = scr; scrM.diffuseColor = C("#050807"); scrM.specularColor = C("#334433"); scrM.specularPower = 64; scr.level = 0;
  const screen = CreatePlane("dScreenP", { width: 0.18, height: 0.09 }, scene); screen.parent = dev; screen.position.set(0.07, 0.04, 0.1465); screen.rotation.y = Math.PI; screen.material = scrM;
  part("dBezel", 0.198, 0.106, 0.008, 0.07, 0.04, 0.139, chromeM);
  for (const [x, y, d] of [[0.03, -0.065, 0.045], [0.125, -0.065, 0.035], [0.19, 0.045, 0.028]]) {
    const kb = CreateCylinder("dKnob", { diameter: d, height: 0.022, tessellation: 24 }, scene); kb.parent = dev; kb.rotation.x = Math.PI / 2; kb.position.set(x, y, 0.15); kb.material = knobM; casters.push(kb);
    const cap = CreateCylinder("dCap", { diameter: d * 0.5, height: 0.004, tessellation: 20 }, scene); cap.parent = dev; cap.rotation.x = Math.PI / 2; cap.position.set(x, y, 0.162); cap.material = chromeM;
  }
  for (let i = 0; i < 3; i++) { const sw = CreateCylinder("dSwitch", { diameter: 0.006, height: 0.026, tessellation: 10 }, scene); sw.parent = dev; sw.position.set(-0.2 + i * 0.03, 0.085, 0.15); sw.rotation.x = Math.PI / 2 - 0.4; sw.material = chromeM; }
  const ledM = unlit(scene, "dLedM", "#3a0a08", 1); const led = CreateIcoSphere("dLed", { radius: 0.005, subdivisions: 1 }, scene); led.parent = dev; led.position.set(0.19, -0.01, 0.142); led.material = ledM;
  // telescopic antenna leaning back, and a carry handle
  let ay = 0.13; for (const [r, l] of [[0.006, 0.22], [0.0045, 0.2], [0.003, 0.18]]) { const a = CreateCylinder("dAnt", { diameter: r * 2, height: l, tessellation: 10 }, scene); a.parent = dev; a.material = chromeM; a.rotation.set(-0.42, 0, 0.18); a.position.set(0.2 - (ay - 0.13) * 0.18, ay + l / 2 * Math.cos(0.42), -0.08 - (ay - 0.13 + l / 2) * Math.sin(0.42)); ay += l * Math.cos(0.42) * 0.96; casters.push(a); }
  const handle = CreateTorus("dHandle", { diameter: 0.3, thickness: 0.014, tessellation: 32 }, scene); handle.parent = dev; handle.material = knobM; handle.rotation.x = Math.PI / 2; handle.scaling.set(1, 1, 0.35); handle.position.set(0, 0.13, 0);
  const cable = CreateTube("dCable", { path: [new Vector3(-0.25, -0.05, -0.05), new Vector3(-0.42, -0.13, -0.12), new Vector3(-0.62, -0.13, -0.38), new Vector3(-0.7, -0.6, -1.05), new Vector3(-0.72, -0.93, -1.15)], radius: 0.006, tessellation: 8 }, scene);
  cable.parent = dev; cable.material = knobM;
  const screenLight = new PointLight("dScreenLight", new Vector3(0, 0, 0), scene); screenLight.parent = dev; screenLight.position.set(0.08, 0.05, 0.3); screenLight.diffuse = C("#ffb35a"); screenLight.intensity = 0; screenLight.range = 2.2;

  const key = makeKey(scene, root);
  key.root.position.copyFrom(KEY_AT); key.root.position.y += 0.006; key.root.rotation.set(Math.PI / 2, 0.5, 0); // lying on the table until it is offered
  const keyLight = new PointLight("keyGlint", new Vector3(0, 0, 0), scene); keyLight.parent = root; keyLight.position.set(KEY_AT.x + 0.25, KEY_AT.y + 0.35, KEY_AT.z + 0.3); keyLight.diffuse = C("#ffd9a0"); keyLight.intensity = 0; keyLight.range = 1.4;

  const faceLight = new PointLight("momFace", new Vector3(0, 0, 0), scene); faceLight.parent = root; faceLight.diffuse = C("#ffd2a0"); faceLight.intensity = 0; faceLight.range = 2.4;
  // ---- light: the dawn shaft through the window, a cool fill, the doorway behind the mother ----
  const SH = new Vector3(0.22, -0.42, 1).normalize();
  const sunIn = new DirectionalLight("hSun", SH, scene); sunIn.position = o.add(new Vector3(0.1, 1.6, -D)).subtract(SH.scale(6)); sunIn.diffuse = C("#ffc58e"); sunIn.intensity = 3.4;
  const fill = new HemisphericLight("hFill", new Vector3(0, 1, 0.2), scene); fill.diffuse = C("#7f8bb0"); fill.groundColor = C("#3a2a20"); fill.intensity = 0.32;
  const doorLight = new PointLight("hDoorLight", new Vector3(0, 0, 0), scene); doorLight.parent = root; doorLight.position.set(W + 0.6, 1.6, (DOOR.z0 + DOOR.z1) / 2); doorLight.diffuse = C("#ffcf9a"); doorLight.intensity = 2.2; doorLight.range = 5;
  const lampLight = new PointLight("hLamp", new Vector3(0, 0, 0), scene); lampLight.parent = root; lampLight.position.set(-1.2, 2.3, 0.6); lampLight.diffuse = C("#ffaa55"); lampLight.intensity = 0.55; lampLight.range = 4;
  let shadows = null;
  if (!low) {
    shadows = new ShadowGenerator(high ? 2048 : 1024, sunIn); shadows.usePercentageCloserFiltering = true; shadows.filteringQuality = high ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    shadows.bias = 0.0015; shadows.normalBias = 0.01; sunIn.shadowMinZ = 0.5; sunIn.shadowMaxZ = 16; sunIn.autoUpdateExtends = true;
    for (const m of casters) shadows.addShadowCaster(m, false);
    for (const m of key.meshes) shadows.addShadowCaster(m, false);
  }
  // a soft shaft of light (two crossed planes along the beam), and dust drifting in it
  const shaftTex = canvasTex(scene, 64, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(255,214,160,0.55)"); g.addColorStop(1, "rgba(255,214,160,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); const e = x.createLinearGradient(0, 0, w, 0); e.addColorStop(0, "rgba(0,0,0,1)"); e.addColorStop(0.3, "rgba(0,0,0,0)"); e.addColorStop(0.7, "rgba(0,0,0,0)"); e.addColorStop(1, "rgba(0,0,0,1)"); x.globalCompositeOperation = "destination-out"; x.fillStyle = e; x.fillRect(0, 0, w, h); }, { alpha: true, name: "shaft" });
  const shaftM = additive(scene, "hShaftM", shaftTex, 0.38, { fogEnabled: false });
  const shafts = [];
  for (const ry of [0, Math.PI / 2]) {
    const p = CreatePlane("hShaft", { width: 1.15, height: 3.4 }, scene); p.parent = root; p.material = shaftM;
    const start = new Vector3((WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, -D), mid = start.add(SH.scale(1.7));
    p.position.copyFrom(mid); p.lookAt(o.add(mid).add(SH), 0, Math.PI / 2); p.rotate(new Vector3(0, 0, 1), ry, 0); shafts.push(p);
  }
  let dust = null;
  if (!low) {
    dust = new ParticleSystem("hDust", high ? 340 : 160, scene);
    dust.particleTexture = radialTex(scene, [[0, "rgba(255,240,215,1)"], [0.4, "rgba(255,230,200,0.5)"], [1, "rgba(255,230,200,0)"]], 32, "dustTex");
    dust.emitter = new Vector3(o.x + 0.12, o.y + 1.2, o.z - 1.3);
    dust.minEmitBox = new Vector3(-0.7, -0.6, -0.9); dust.maxEmitBox = new Vector3(0.7, 0.7, 0.9);
    dust.color1 = new Color3(1, 0.92, 0.8).toColor4(0.55); dust.color2 = new Color3(1, 0.85, 0.7).toColor4(0.35); dust.colorDead = new Color3(0, 0, 0).toColor4(0);
    dust.minSize = 0.004; dust.maxSize = 0.011; dust.minLifeTime = 5; dust.maxLifeTime = 9; dust.emitRate = high ? 46 : 22;
    dust.direction1 = new Vector3(-0.02, 0.01, -0.02); dust.direction2 = new Vector3(0.03, 0.03, 0.03); dust.minEmitPower = 0.2; dust.maxEmitPower = 0.5; dust.updateSpeed = 0.01;
    dust.blendMode = ParticleSystem.BLENDMODE_ADD; dust.gravity = new Vector3(0, -0.002, 0); dust.preWarmCycles = 300; dust.preWarmStepOffset = 4;
  }

  // ---- the people: the protagonist at the table, the mother ----
  const hero = spawnCharacter(await models.get(heroUrl), 1.72, "pHero"); hero.root.parent = root; hero.root.position.set(-0.08, 0, -0.32); hero.root.rotation.y = Math.PI;
  const mom = spawnCharacter(await models.get(momUrl), 1.62, "pMom"); mom.root.parent = root; mom.root.position.set(W - 0.35, 0, (DOOR.z0 + DOOR.z1) / 2); mom.root.rotation.y = -Math.PI / 2;
  for (const m of [...hero.meshes, ...mom.meshes]) { m.receiveShadows = true; shadows?.addShadowCaster(m, false); }
  hero.groups.Idle?.start(true, 1); mom.groups.Idle?.start(true, 0.9);
  // the mother's dress: deep indigo, the colour of the village's women's festive clothes at dawn
  const DRESS = { White: "#2c2f4c", Grey: "#3b3652", Orange: "#7a2e2a", Brown: "#3a2a24" };
  for (const m of mom.meshes) { const nm = Object.keys(DRESS).find((k) => new RegExp("^" + k, "i").test((m.material?.name || "").split(/[:.]/).pop()) || (m.material?.name || "").includes(k)); if (nm) m.material.albedoColor = C(DRESS[nm]); }
  const wrist = mom.root.getDescendants(false).find((n) => /Wrist\.R$/.test(n.name));

  scope(root, [sunIn, fill, doorLight, lampLight, screenLight, keyLight, faceLight]);
  if (dust) dust.stop();

  // ---- the screen's states ----
  // the screen speaks Arabic: the line Yousuf is saying, in the game's display face (Cairo), right to left
  let screenOn = 0, msg = 0, line = "", ended = false;
  const FONT = '"GmDisplay", "Noto Sans Arabic", Tahoma, sans-serif';
  const wrapRtl = (text, maxW) => { const out = []; let cur = ""; for (const wd of text.split(" ")) { const tryL = cur ? cur + " " + wd : wd; if (sx.measureText(tryL).width > maxW && cur) { out.push(cur); cur = wd; } else cur = tryL; } if (cur) out.push(cur); return out; };
  const paintScreen = (t) => {
    const w = 512, h = 256;
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.direction = "ltr"; sx.textAlign = "start"; sx.fillStyle = "#050806"; sx.fillRect(0, 0, w, h);
    if (screenOn <= 0) { scr.update(true); return; }
    try {
      sx.setTransform(-1, 0, 0, 1, w, 0); // the plane faces the room in the right-handed scene: draw mirrored so it reads (verified on a capture)
      const a = Math.min(1, screenOn * 1.2), amber = (k, al = 1) => `rgba(255,${(176 + 40 * k) | 0},${(90 + 40 * k) | 0},${a * al})`;
      sx.fillStyle = `rgba(255,150,60,${0.06 * a})`; sx.fillRect(0, 0, w, h);
      sx.strokeStyle = `rgba(255,170,80,${0.08 * a})`; sx.lineWidth = 1; for (let i = 0; i < 16; i++) { sx.beginPath(); sx.moveTo(0, i * 16 + 8); sx.lineTo(w, i * 16 + 8); sx.stroke(); }
      // header: the source on the right (Arabic), the date on the left
      sx.font = `800 26px ${FONT}`; sx.fillStyle = amber(0.4); sx.direction = "rtl"; sx.textAlign = "right";
      sx.fillText(msg || ended ? "تسجيل — يوسف" : "إشارة…", w - 18, 36);
      sx.direction = "ltr"; sx.textAlign = "left"; sx.font = "700 20px monospace"; sx.fillStyle = amber(0, 0.75); sx.fillText(msg || ended ? "06.03.2067" : "...", 18, 34);
      sx.fillStyle = amber(0, 0.35); sx.fillRect(18, 48, w - 36, 2);
      // the words: the current line, wrapped, large enough to read in the close-up
      if (msg && line) {
        sx.font = `800 36px ${FONT}`; sx.direction = "rtl"; sx.textAlign = "right"; sx.fillStyle = amber(1);
        const rows = wrapRtl(line, w - 44).slice(0, 2); rows.forEach((r, i) => sx.fillText(r, w - 22, 100 + i * 50 - (rows.length - 1) * 8));
      } else if (ended) {
        sx.font = `800 30px ${FONT}`; sx.direction = "rtl"; sx.textAlign = "right"; sx.fillStyle = amber(0.6, 0.85); sx.fillText("انتهى التسجيل", w - 22, 112);
      }
      sx.direction = "ltr"; sx.textAlign = "left";
      // the voice: a waveform, and the recording's progress
      sx.strokeStyle = amber(0.8, msg ? 0.9 : 0.6); sx.lineWidth = 2.4; sx.beginPath();
      for (let i = 0; i <= w; i += 4) { const k = i / w, v = msg ? (Math.sin(i * 0.11 + t * 18) * 0.5 + Math.sin(i * 0.035 - t * 9) * 0.5) * (0.35 + 0.65 * Math.abs(Math.sin(t * 3.1 + k * 4))) : Math.sin(i * 0.2 + t * 30) * 0.15 * Math.random(); sx.lineTo(i, 188 + v * 22); }
      sx.stroke();
      const prog = msg ? Math.min(1, ((t * 0.09) % 1)) : ended ? 1 : 0.02;
      sx.fillStyle = amber(0.5); sx.fillRect(18, 228, prog * (w - 36), 8); sx.strokeStyle = amber(0); sx.lineWidth = 1.5; sx.strokeRect(18, 228, w - 36, 8);
      if (Math.random() < 0.06) { sx.fillStyle = "rgba(255,200,120,0.1)"; sx.fillRect(0, Math.random() * h, w, 8); }
    } catch (e) { console.warn("[prologue] screen", e); }
    sx.setTransform(1, 0, 0, 1, 0, 0);
    scr.update(true);
  };
  try { await document.fonts?.load?.(`800 36px "GmDisplay"`, "مجتمع"); } catch { /* the fallback face draws Arabic too */ }
  paintScreen(0);

  let posedKey = false;
  return {
    root, name: "home", hero, mom, key, dust, wrist,
    look: { clear: "#120d0a", fog: "#1a1410", fogDensity: 0.0001, env: 0.18, exposure: 1.18, contrast: 1.18, glow: 0.6, sky: null },
    deviceOn() { screenOn = 0.01; ledM.emissiveColor = C("#ff4630").scale(1.6); },
    message(on) { msg = on ? 1 : 0; if (!on) ended = true; },
    /** the Arabic line Yousuf is saying now, shown on the device's screen */
    screenLine(text) { line = text || ""; },
    /** where the mother's face is while she offers the key (world), for the camera */
    momHead() { return this._offer ? o.add(this._offer.at).add(new Vector3(0, 1.42, 0)) : o.add(new Vector3(0.55, 1.42, -1.95)); },
    /** Work out, once, where the mother stands at the table with her hand out (her Interact gesture held at its
     *  furthest reach towards the protagonist) and where the key sits in that hand. Returns the key's world position. */
    prepareOffer() {
      const g = mom.groups.Interact;
      if (!g || !wrist) return (this.keyAt = o.add(KEY_AT));
      const all = [mom.root, ...mom.root.getDescendants(false)], settle = () => { for (const n of all) n.computeWorldMatrix?.(true); };
      const keep = { p: mom.root.position.clone(), r: mom.root.rotation.y };
      mom.groups.Idle?.stop(); mom.root.position.set(0.55, 0, -1.95); mom.root.rotation.y = 0;
      g.start(false, 1, g.from, g.to); let best = g.from, bz = -1e9;
      for (let f = g.from; f <= g.to; f += Math.max(1, (g.to - g.from) / 24)) { g.goToFrame(f); settle(); const p = wrist.getAbsolutePosition(); if (p.z > bz) { bz = p.z; best = f; } }
      g.goToFrame(best); settle();
      const want = o.add(KEY_AT), p = wrist.getAbsolutePosition();
      const at = mom.root.position.add(want.subtract(p).multiplyByFloats(1, 0, 1));
      this._offer = { frame: best, at };
      mom.root.position.copyFrom(at); settle();
      const keyAt = wrist.getAbsolutePosition().add(new Vector3(0, -0.035, 0.05));
      g.stop(); mom.root.position.copyFrom(keep.p); mom.root.rotation.y = keep.r; mom.groups.Idle?.start(true, 0.9);
      return (this.keyAt = keyAt);
    },
    /** cut to the offer: the mother at the table, hand out, the key in it */
    offerKey() {
      if (posedKey) return; posedKey = true; keyLight.intensity = 1.6; faceLight.intensity = 0.9;
      faceLight.position.copyFrom(this.momHead().subtract(o).add(new Vector3(-0.25, 0.05, 0.75))); keyLight.position.copyFrom(this.keyAt.subtract(o).add(new Vector3(-0.18, 0.22, 0.32)));
      key.root.parent = root; key.root.position.copyFrom(this.keyAt.subtract(o)); key.root.rotation.set(0.35, -Math.PI / 2 + 0.4, -0.25);
      const g = mom.groups.Interact; if (!g || !this._offer) return;
      mom.groups.Idle?.stop(); mom.root.rotation.y = 0; mom.root.position.copyFrom(this._offer.at);
      g.start(false, 1, g.from, g.to); g.goToFrame(this._offer.frame); g.pause();
    },
    heroFace(x, z) { hero.root.rotation.y = Math.atan2(x - hero.root.position.x, z - hero.root.position.z); },
    update(dt, t) {
      if (screenOn > 0) { screenOn = Math.min(1, screenOn + dt * (screenOn < 0.3 ? 0.5 : 1.6)); const flick = screenOn < 0.6 && Math.random() < 0.25 ? 0.3 : 1; scr.level = flick * 1.15; screenLight.intensity = 0.65 * screenOn * flick; }
      if (Math.floor(t * 15) !== Math.floor((t - dt) * 15)) paintScreen(t);
      if (screenOn > 0.99) ledM.emissiveColor = C(Math.floor(t * 2) % 2 ? "#ff4630" : "#5a0f0a").scale(1.4);
      lampLight.intensity = 0.5 + Math.sin(t * 11) * 0.04 + Math.sin(t * 4.3) * 0.03;
    },
    shadows
  };
}

// ---------------------------------------------------------------- 3 · the magnetic train at night
function trainBody(scene, name, len, nose, mat) {
  const shape = [];
  for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); shape.push(new Vector3(Math.sign(c) * Math.pow(Math.abs(c), 0.55) * 1.7, Math.sign(s) * Math.pow(Math.abs(s), 0.75) * 1.75 + (s < 0 ? 0.25 : 0), 0)); }
  const path = []; const n = nose ? 26 : 2; for (let i = 0; i <= n; i++) path.push(new Vector3(0, 0, -len * (i / n)));
  const m = ExtrudeShapeCustom(name, {
    shape, path, cap: Mesh.CAP_ALL, closeShape: true,
    scaleFunction: (i) => { if (!nose) return 1; const k = i / n, tip = Math.max(0, (k - 0.55) / 0.45); return Math.max(0.06, Math.sqrt(1 - tip * tip * 0.96)); },
    rotationFunction: () => 0
  }, scene);
  m.material = mat; return m;
}
export async function buildTrain(scene, origin, { low, high }) {
  const root = new TransformNode("set-train", scene); root.position.set(...origin);
  const R = rnd(77);
  const moon = new DirectionalLight("tMoon", new Vector3(0.4, -0.6, -0.5).normalize(), scene); moon.diffuse = C("#8ea3d6"); moon.intensity = 0.55;
  const hemi = new HemisphericLight("tSky", new Vector3(0, 1, 0), scene); hemi.diffuse = C("#2a3558"); hemi.groundColor = C("#0c0a0c"); hemi.intensity = 0.4;
  const under = new PointLight("tUnder", new Vector3(0, 0, 0), scene); under.parent = root; under.position.set(0, 7.2, -5); under.diffuse = C("#9fd6ff"); under.intensity = 1.6; under.range = 40;
  const cabinGlow = new PointLight("tWin", new Vector3(0, 0, 0), scene); cabinGlow.parent = root; cabinGlow.position.set(-4, 10.5, 0); cabinGlow.diffuse = C("#ffd29a"); cabinGlow.intensity = 0.9; cabinGlow.range = 30;

  const shell = pbr(scene, "tShell", "#d9dde2", 0.22, 0.85, { environmentIntensity: 0.55 });
  shell.clearCoat.isEnabled = !low; shell.clearCoat.intensity = 0.7;
  const dark = pbr(scene, "tDark", "#14171c", 0.4, 0.6, { environmentIntensity: 0.4 });
  const winM = unlit(scene, "tWinM", "#ffd8a6", 1.25);
  const stripe = unlit(scene, "tStripe", "#e8b85a", 1.4);
  const train = new TransformNode("train", scene); train.parent = root; train.position.set(0, 10, 0);
  const CAR = 24, GAP = 1.2, cars = low ? 3 : 4;
  for (let c = 0; c < cars; c++) {
    const z0 = 40 - c * (CAR + GAP), nose = c === cars - 1;
    const b = trainBody(scene, "tCar", nose ? CAR + 10 : CAR, nose, shell); b.parent = train; b.position.z = z0;
    for (const s of [-1, 1]) {
      for (let w = 0; w < (nose ? 7 : 8); w++) { const p = CreatePlane("tWindow", { width: 2.1, height: 0.75 }, scene); p.parent = train; p.material = winM; p.position.set(s * 1.72, 0.62, z0 - 1.8 - w * 2.75); p.rotation.y = s * Math.PI / 2; p.rotation.z = s * -0.18; }
      const st = CreatePlane("tLine", { width: CAR - 1, height: 0.07 }, scene); st.parent = train; st.material = stripe; st.position.set(s * 1.69, -0.35, z0 - CAR / 2); st.rotation.y = s * Math.PI / 2;
    }
    const skirt = CreateBox("tSkirt", { width: 2.6, height: 0.5, depth: (nose ? CAR + 4 : CAR) - 0.6 }, scene); skirt.parent = train; skirt.material = dark; skirt.position.set(0, -1.75, z0 - (nose ? CAR + 4 : CAR) / 2);
    if (c > 0) { const g = CreateCylinder("tGap", { diameter: 3, height: GAP + 0.4, tessellation: 20 }, scene); g.parent = train; g.material = dark; g.rotation.x = Math.PI / 2; g.position.set(0, 0.05, z0 + GAP / 2); }
  }
  const noseZ = 40 - (cars - 1) * (CAR + GAP) - CAR - 10;
  const headM = unlit(scene, "tHead", "#fff3d6", 2.6);
  for (const s of [-1, 1]) { const h = CreatePlane("tHeadL", { width: 0.9, height: 0.12 }, scene); h.parent = train; h.material = headM; h.position.set(s * 0.6, -0.1, noseZ + 4.2); h.rotation.set(0.3, Math.PI + s * 0.5, 0); }
  // the levitation gap: a soft cold light between the train and the guideway
  const gapTex = canvasTex(scene, 16, 64, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(160,215,255,0)"); g.addColorStop(0.5, "rgba(160,215,255,0.9)"); g.addColorStop(1, "rgba(160,215,255,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); }, { alpha: true, name: "gap" });
  for (const s of [-1, 1]) { const p = CreatePlane("tLev", { width: 120, height: 0.5 }, scene); p.parent = root; p.material = additive(scene, "tLevM", gapTex, 0.9); p.position.set(s * 1.3, 7.95, -12); p.rotation.y = Math.PI / 2; }

  // the guideway: a long beam on pylons; pylons, lamps and far lights move (the train "travels" through them)
  const beamM = pbr(scene, "tBeam", "#5a5f68", 0.45, 0.6, { environmentIntensity: 0.4 });
  const beam = CreateBox("tGuide", { width: 3.2, height: 1.1, depth: 900 }, scene); beam.parent = root; beam.position.set(0, 7.2, -200); beam.material = beamM;
  const rail = CreateBox("tRail", { width: 0.25, height: 0.18, depth: 900 }, scene); rail.parent = root; rail.material = unlit(scene, "tRailM", "#b9dcff", 0.55); rail.position.set(0, 7.84, -200);
  const SP = 22, NP = 20;
  const pylon = CreateBox("tPylon", { width: 1.3, height: 7, depth: 1.6 }, scene); pylon.parent = root; pylon.material = beamM; pylon.position.y = 3.5;
  const head = CreateBox("tPylonHead", { width: 5, height: 0.7, depth: 1.8 }, scene); head.parent = root; head.material = beamM; head.position.y = 6.5;
  const lamp = CreateBox("tLamp", { width: 0.25, height: 0.12, depth: 0.6 }, scene); lamp.parent = root; lamp.material = unlit(scene, "tLampM", "#ffcf8a", 2.2); lamp.position.y = 6.9;
  const mp = [], mh = [], ml = [];
  for (let i = 0; i < NP; i++) { const z = 60 - i * SP; mp.push(matrixAt(0, 0, z, 1, 1, 1)); mh.push(matrixAt(0, 0, z, 1, 1, 1)); ml.push(matrixAt(2.6, 0, z, 1, 1, 1), matrixAt(-2.6, 0, z, 1, 1, 1)); }
  thin(pylon, mp); thin(head, mh); thin(lamp, ml);
  // the land below: dark, with scattered lights of the plain; the city's glow far ahead
  const land = CreateGround("tLand", { width: 1400, height: 1400 }, scene); land.parent = root; land.position.set(0, -2, -300); land.material = pbr(scene, "tLandM", "#0d0e12", 0.95, 0);
  const dot = CreatePlane("tFar", { width: 1, height: 1 }, scene); dot.parent = root; dot.billboardMode = Mesh.BILLBOARDMODE_ALL; dot.material = unlit(scene, "tFarM", "#ffcf96", 1.5);
  const md = []; for (let i = 0; i < (low ? 120 : 280); i++) { const x = (R() - 0.5) * 900, z = 80 - R() * 900; if (Math.abs(x) < 30) continue; const s = 0.6 + R() * 1.4; md.push(matrixAt(x, -1 + R() * 3, z, s, s, s)); }
  thin(dot, md);
  const glowTex = radialTex(scene, [[0, "rgba(255,196,110,0.75)"], [0.35, "rgba(255,170,90,0.25)"], [1, "rgba(255,150,80,0)"]], 128, "cityGlow");
  const cityGlow = CreatePlane("tCityGlow", { width: 900, height: 260 }, scene); cityGlow.parent = root; cityGlow.position.set(40, 20, -720); cityGlow.material = additive(scene, "tCityGlowM", glowTex, 0.6, { fogEnabled: false });
  const near = CreateBox("tStruct", { width: 2, height: 1, depth: 2 }, scene); near.parent = root; near.material = dark; // trackside frames and masts close to the line
  const mn = []; for (let i = 0; i < 26; i++) { const s = R() < 0.5 ? -1 : 1, z = 60 - R() * 460, h = 3 + R() * 14; mn.push(matrixAt(s * (14 + R() * 30), h / 2 - 2, z, 1.5 + R() * 4, h, 1.5 + R() * 4)); }
  thin(near, mn);
  // speed: two long veils of passing light either side of the guideway, scrolled fast (reads as motion even in a still)
  const speedTex = canvasTex(scene, 1024, 64, (x, w, h) => { const Rs = rnd(31); x.clearRect(0, 0, w, h); for (let i = 0; i < 70; i++) { const y = Rs() * h, len = 40 + Rs() * 260, g = x.createLinearGradient(0, 0, len, 0), c = Rs() < 0.6 ? "160,205,255" : "255,205,140"; g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(0.7, `rgba(${c},${0.25 + Rs() * 0.5})`); g.addColorStop(1, `rgba(${c},0)`); x.save(); x.translate(Rs() * w, y); x.fillStyle = g; x.fillRect(0, 0, len, 1 + Rs() * 2); x.restore(); } }, { wrap: true, alpha: true, name: "speed" });
  const speedM = additive(scene, "tSpeedM", speedTex, 0.55, { fogEnabled: false });
  const veils = [];
  for (const sx of [-1, 1]) { const p = CreatePlane("tSpeed", { width: 260, height: 7 }, scene); p.parent = root; p.material = speedM; p.position.set(sx * 7.5, 8.5, -60); p.rotation.y = sx * Math.PI / 2; veils.push(p); }
  scope(root, [moon, hemi, under, cabinGlow]);
  return {
    root, name: "train",
    look: { clear: "#05070d", fog: "#0a0e1a", fogDensity: 0.0042, env: 0.25, exposure: 1.1, contrast: 1.2, glow: 0.7,
      sky: [[0, "#03050c"], [0.38, "#0b1224"], [0.48, "#2a2338"], [0.5, "#4a3326"], [0.53, "#0a0a10"], [1, "#030304"]] },
    update(dt, t) {
      const v = 62; // m/s past the camera
      for (const m of [pylon, head, lamp]) { m.position.z += v * dt; if (m.position.z >= SP) m.position.z -= SP; } // periodic: wrapping by one span is seamless
      dot.position.z += v * 0.35 * dt; if (dot.position.z > 300) dot.position.z -= 600;
      speedTex.uOffset -= dt * 0.9;
      near.position.z += v * dt; if (near.position.z > 230) near.position.z -= 460;
      train.position.y = 10 + Math.sin(t * 1.7) * 0.03; train.rotation.z = Math.sin(t * 0.9) * 0.003;
    }
  };
}

// ---------------------------------------------------------------- 4 · the city reveal
function windowsTex(scene, seed, cols, rows, lit, size = 256) {
  const R = rnd(seed);
  const em = canvasTex(scene, size, size * 2, (x, w, h) => {
    x.fillStyle = "#000"; x.fillRect(0, 0, w, h);
    const cw = w / cols, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const band = R() < 0.08; // a whole lit floor now and then
      for (let c = 0; c < cols; c++) {
        const k = R(); if (!(band ? k < 0.7 : k < lit)) continue;
        const warm = R() < 0.7, a = 0.45 + R() * 0.55;
        x.fillStyle = warm ? `rgba(255,${(196 + R() * 30) | 0},${(130 + R() * 40) | 0},${a})` : `rgba(${(190 + R() * 40) | 0},220,255,${a * 0.8})`;
        x.fillRect(c * cw + cw * 0.18, r * rh + rh * 0.22, cw * 0.64, rh * 0.56);
      }
    }
  }, { wrap: true, name: "cityWin" });
  return em;
}
function facadeTex(scene, cols, rows, size = 256, base = ["#1a2232", "#0b111c", "#283246"]) {
  return canvasTex(scene, size, size * 2, (x, w, h) => {
    x.fillStyle = base[0]; x.fillRect(0, 0, w, h);
    const cw = w / cols, rh = h / rows; x.fillStyle = base[1];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) x.fillRect(c * cw + cw * 0.12, r * rh + rh * 0.16, cw * 0.76, rh * 0.68);
    x.fillStyle = base[2]; for (let r = 0; r < rows; r++) x.fillRect(0, r * rh, w, rh * 0.1);
  }, { wrap: true, name: "cityFacade" });
}
export async function buildCity(scene, origin, { low, high }) {
  const root = new TransformNode("set-city", scene); root.position.set(...origin);
  const R = rnd(2077);
  const moon = new DirectionalLight("cMoon", new Vector3(0.5, -0.5, 0.7).normalize(), scene); moon.diffuse = C("#7d8fc4"); moon.intensity = 0.5;
  const hemi = new HemisphericLight("cSky", new Vector3(0, 1, 0), scene); hemi.diffuse = C("#4a5f94"); hemi.groundColor = C("#4a3520"); hemi.intensity = 0.75;
  const coreLight = new PointLight("cCore", new Vector3(0, 0, 0), scene); coreLight.parent = root; coreLight.position.set(0, 60, 0); coreLight.diffuse = C("#ffb54a"); coreLight.intensity = 2.4; coreLight.range = 420;

  // the ground: avenues of light on a dark grid
  const gridTex = canvasTex(scene, 512, 512, (x, w, h) => {
    x.fillStyle = "#07090f"; x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(255,190,110,0.55)"; x.fillRect(0, h / 2 - 3, w, 6); x.fillRect(w / 2 - 3, 0, 6, h);
    x.fillStyle = "rgba(255,210,150,0.18)"; for (let i = 0; i < 8; i++) { x.fillRect(0, i * 64, w, 1.5); x.fillRect(i * 64, 0, 1.5, h); }
  }, { wrap: true, name: "cityGrid" });
  const ground = CreateGround("cGround", { width: 4000, height: 4000 }, scene); ground.parent = root;
  const gm = new StandardMaterial("cGroundM", scene); gm.diffuseColor = C("#0a0c12"); gm.specularColor = Color3.Black(); gm.emissiveTexture = gridTex; gridTex.uScale = gridTex.vScale = 4000 / 120; ground.material = gm;

  // the towers: four base shapes with tiled facades, thousands of instances, taller towards the core
  const camPath = [[-360, 600], [-150, 260]]; // keep the camera's flight clear
  const clear = (x, z) => { const [[ax, az], [bx, bz]] = camPath, dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1.1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
  const kinds = [[24, 60, 6, 18, 0.16], [18, 110, 5, 32, 0.13], [34, 30, 9, 9, 0.2], [22, 160, 6, 46, 0.11]];
  // four facade families: slate, blue glass, warm stone, pale steel (the city's white-gold-blue)
  const FACADES = [["#1c2436", "#0b111c", "#2b354a"], ["#1d3050", "#0a1830", "#33507a"], ["#3a3128", "#17120e", "#5a4a36"], ["#3a4256", "#141a26", "#6a7590"]];
  const N = low ? 520 : high ? 1500 : 950;
  const mats = kinds.map(() => []);
  for (let i = 0, tries = 0; i < N && tries < N * 8; tries++) {
    const a = R() * Math.PI * 2, rr = 70 + Math.pow(R(), 0.62) * 1500, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (Math.abs(x % 120) < 14 || Math.abs(z % 120) < 14) continue; // the avenues
    if (clear(x, z) < 46) continue;
    const near = 1 - Math.min(1, rr / 1300), k = R() < 0.5 ? (near > 0.55 ? 3 : 1) : R() < 0.6 ? 0 : 2, bh = kinds[k][1];
    const hs = (0.55 + near * 1.2) * (0.7 + R() * 0.6) * (k === 3 ? Math.min(1, 140 / (bh * (0.55 + near * 1.2))) : 1), ws = 0.8 + R() * 0.5;
    mats[k].push(matrixAt(x, (bh * hs) / 2, z, ws, hs, ws * (0.8 + R() * 0.4), Math.round(R() * 4) * (Math.PI / 2) + (R() - 0.5) * 0.05)); i++;
  }
  kinds.forEach(([bw, bh, cols, rows, lit], k) => {
    const em = windowsTex(scene, 100 + k, cols * 2, rows, lit), df = facadeTex(scene, cols * 2, rows, 256, FACADES[k]);
    const m = pbr(scene, "cTowerM" + k, "#ffffff", 0.55, 0.25, { albedoTexture: df, emissiveTexture: em, environmentIntensity: 0.5 }); m.emissiveColor = new Color3(1.25, 1.2, 1.1);
    const b = tiledBox(scene, "cTower" + k, bw, bh, bw, bw); b.parent = root; b.material = m; thin(b, mats[k]); b.alwaysSelectAsActiveMesh = true;
  });

  // landmarks: a few distinct silhouettes in the middle ground (stepped, cylindrical, a pair with a sky bridge)
  const glass = pbr(scene, "cGlass", "#20304a", 0.12, 0.9, { environmentIntensity: 0.55 });
  const lmEm = windowsTex(scene, 9, 14, 40, 0.12);
  const lmM = pbr(scene, "cLandM", "#ffffff", 0.45, 0.35, { albedoTexture: facadeTex(scene, 14, 40), emissiveTexture: lmEm, environmentIntensity: 0.55 }); lmM.emissiveColor = new Color3(1.3, 1.25, 1.15);
  const trim = unlit(scene, "cTrim", "#ffd08a", 1.1);
  const L = (x, z, f) => { const n = new TransformNode("landmark", scene); n.parent = root; n.position.set(x, 0, z); f(n); };
  const stepped = (n, w, h0) => { let y = 0, ww = w; for (let s = 0; s < 4; s++) { const hh = h0 * (0.42 - s * 0.07); const b = tiledBox(scene, "cStep", ww, hh, ww, 14); b.parent = n; b.position.y = y + hh / 2; b.material = lmM; const t = CreateBox("cTrimL", { width: ww + 0.6, height: 0.8, depth: ww + 0.6 }, scene); t.parent = n; t.position.y = y + hh; t.material = trim; y += hh; ww *= 0.74; } const sp = CreateCylinder("cSpire", { diameterTop: 0.3, diameterBottom: 2.4, height: h0 * 0.22, tessellation: 8 }, scene); sp.parent = n; sp.position.y = y + h0 * 0.11; sp.material = glass; };
  const round = (n, d, h) => { const c = CreateCylinder("cRound", { diameter: d, height: h, tessellation: 40, faceUV: [new Vector4(0, 0, 0.1, 0.1), new Vector4(0, 0, 6, h / 14), new Vector4(0, 0, 0.1, 0.1)] }, scene); c.parent = n; c.position.y = h / 2; c.material = lmM; for (let i = 1; i < 6; i++) { const r = CreateTorus("cRing", { diameter: d + 1.2, thickness: 0.6, tessellation: 40 }, scene); r.parent = n; r.position.y = (h * i) / 6; r.material = trim; } const cr = CreateCylinder("cCrown", { diameterTop: d * 0.4, diameterBottom: d * 0.9, height: 14, tessellation: 40 }, scene); cr.parent = n; cr.position.y = h + 7; cr.material = glass; };
  const twin = (n, w, h) => { for (const s of [-1, 1]) { const b = tiledBox(scene, "cTwin", w, h, w, 14); b.parent = n; b.position.set(s * w * 0.95, h / 2, 0); b.material = lmM; } const br = CreateBox("cBridge", { width: w * 1.9, height: 6, depth: w * 0.5 }, scene); br.parent = n; br.position.y = h * 0.72; br.material = glass; const bt = CreateBox("cBridgeT", { width: w * 1.9, height: 0.6, depth: w * 0.52 }, scene); bt.parent = n; bt.position.y = h * 0.72 - 3; bt.material = trim; };
  L(-190, 120, (n) => stepped(n, 34, 210)); L(170, 60, (n) => round(n, 28, 150)); L(90, -210, (n) => twin(n, 22, 165)); L(-120, -150, (n) => round(n, 22, 128));
  L(260, -60, (n) => stepped(n, 30, 160)); L(-300, -40, (n) => twin(n, 18, 120)); if (!low) { L(330, 200, (n) => round(n, 24, 110)); L(-40, 260, (n) => stepped(n, 26, 118)); }

  // far silhouettes on the horizon, fading into the haze
  const farM = unlit(scene, "cFarM", "#24315a", 1, { fogEnabled: false });
  const far = CreateBox("cFar", { width: 1, height: 1, depth: 1 }, scene); far.parent = root; far.material = farM;
  const mf = []; for (let i = 0; i < (low ? 140 : 260); i++) { const a = R() * Math.PI * 2, rr = 1700 + R() * 500, h = 40 + R() * 120 * (R() < 0.2 ? 2 : 1); mf.push(matrixAt(Math.cos(a) * rr, h / 2, Math.sin(a) * rr, 30 + R() * 60, h, 30 + R() * 60)); }
  thin(far, mf);

  // the MJT tower: the street's own tower (bjs/tower.js), raised to the city's scale, with its light column and halo
  const tower = buildTower(scene, { z: 0, gateZ: 8.2, low });
  tower.root.parent = root; tower.root.position.set(0, 0, 0);
  const TS = 235 / Math.max(60, tower.topY || 100); tower.root.scaling.setAll(TS);
  const colTex = canvasTex(scene, 64, 512, (x, w, h) => { const g = x.createLinearGradient(0, h, 0, 0); g.addColorStop(0, "rgba(255,200,110,0.9)"); g.addColorStop(0.3, "rgba(255,180,90,0.35)"); g.addColorStop(1, "rgba(255,170,80,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); const e = x.createLinearGradient(0, 0, w, 0); e.addColorStop(0, "rgba(0,0,0,1)"); e.addColorStop(0.35, "rgba(0,0,0,0)"); e.addColorStop(0.65, "rgba(0,0,0,0)"); e.addColorStop(1, "rgba(0,0,0,1)"); x.globalCompositeOperation = "destination-out"; x.fillStyle = e; x.fillRect(0, 0, w, h); }, { alpha: true, name: "column" });
  const colM = additive(scene, "cColumnM", colTex, 0.75, { fogEnabled: false });
  const top = (tower.topY || 100) * TS;
  for (const ry of [0, Math.PI / 2]) { const p = CreatePlane("cColumn", { width: 14, height: 900 }, scene); p.parent = root; p.position.set(0, top + 440, 0); p.rotation.y = ry + 0.4; p.material = colM; }
  const haloTex = radialTex(scene, [[0, "rgba(255,200,110,0.55)"], [0.3, "rgba(255,170,80,0.18)"], [1, "rgba(255,150,60,0)"]], 256, "halo");
  const halo = CreateDisc("cHalo", { radius: 260, tessellation: 48 }, scene); halo.parent = root; halo.rotation.x = Math.PI / 2; halo.position.y = 1.5; halo.material = additive(scene, "cHaloM", haloTex, 0.8);
  const crownGlow = CreatePlane("cCrownGlow", { width: 160, height: 160 }, scene); crownGlow.parent = root; crownGlow.billboardMode = Mesh.BILLBOARDMODE_ALL; crownGlow.position.y = top * 0.92; crownGlow.material = additive(scene, "cCrownGlowM", haloTex, 0.9, { fogEnabled: false });

  // low cloud over the city, lit gold from below near the core
  const cloudTex = canvasTex(scene, 256, 256, (x, w, h) => { const img = x.createImageData(w, h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const n = fbm(i / 30 + 9, j / 30, 4), e = Math.min(1, Math.min(i, w - i, j, h - j) / 50), a = Math.max(0, n - 0.47) * 2.2 * e; const k = (j * w + i) * 4; img.data[k] = 120; img.data[k + 1] = 110; img.data[k + 2] = 130; img.data[k + 3] = Math.min(255, a * 255); } x.putImageData(img, 0, 0); }, { alpha: true, name: "cloud" });
  const clouds = [];
  for (let i = 0; i < (low ? 2 : 4); i++) { const c = CreateGround("cCloud", { width: 1600, height: 1600 }, scene); c.parent = root; c.position.set(-200 + i * 140, 300 + i * 40, -100 - i * 200); c.rotation.y = i; const m = new StandardMaterial("cCloudM", scene); m.diffuseTexture = cloudTex; m.opacityTexture = cloudTex; m.emissiveColor = C("#3a2c32"); m.diffuseColor = C("#8a6a50"); m.specularColor = Color3.Black(); m.alpha = 0.5; m.disableDepthWrite = true; m.backFaceCulling = false; c.material = m; clouds.push(m); }
  // the maglev line arriving into the city, a thread of light
  const line = CreateBox("cLine", { width: 2.5, height: 1.2, depth: 1200 }, scene); line.parent = root; line.position.set(-250, 32, 420); line.rotation.y = -0.55; line.material = pbr(scene, "cLineM", "#3a404a", 0.5, 0.6);
  const lineGlow = CreateBox("cLineGlow", { width: 0.4, height: 0.2, depth: 1200 }, scene); lineGlow.parent = root; lineGlow.position.set(-250, 32.7, 420); lineGlow.rotation.y = -0.55; lineGlow.material = unlit(scene, "cLineGlowM", "#ffd9a0", 1.2);

  // atmospheric depth: a band of haze on the horizon (gold towards the core, blue elsewhere), and air traffic circling the tower
  const hazeTex = canvasTex(scene, 512, 128, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(90,120,200,0)"); g.addColorStop(0.6, "rgba(110,140,210,0.28)"); g.addColorStop(0.85, "rgba(255,190,120,0.32)"); g.addColorStop(1, "rgba(255,190,120,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); }, { wrap: true, alpha: true, name: "haze" });
  const haze = CreateCylinder("cHaze", { diameter: 3200, height: 260, tessellation: 48, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE }, scene); haze.parent = root; haze.position.y = 110;
  haze.material = additive(scene, "cHazeM", hazeTex, 0.9, { fogEnabled: false });
  const near2 = CreateCylinder("cHazeNear", { diameter: 1500, height: 120, tessellation: 40, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE }, scene); near2.parent = root; near2.position.y = 40; near2.material = additive(scene, "cHazeNearM", hazeTex, 0.35, { fogEnabled: false });
  const craft = CreateBox("cCraft", { width: 1.4, height: 0.5, depth: 3.2 }, scene); craft.parent = root; craft.material = unlit(scene, "cCraftM", "#e8f2ff", 2.2);
  const lanes = []; for (let i = 0; i < (low ? 18 : 40); i++) lanes.push({ r: 90 + R() * 260, y: 70 + R() * 140, a: R() * Math.PI * 2, w: (R() < 0.5 ? -1 : 1) * (0.05 + R() * 0.08) });
  const craftBuf = new Float32Array(lanes.length * 16); craft.thinInstanceSetBuffer("matrix", craftBuf, 16, false); craft.alwaysSelectAsActiveMesh = true;
  const placeCraft = () => { lanes.forEach((l, i) => matrixAt(Math.cos(l.a) * l.r, l.y, Math.sin(l.a) * l.r, 1, 1, 1, -l.a + (l.w > 0 ? 0 : Math.PI)).copyToArray(craftBuf, i * 16)); craft.thinInstanceBufferUpdated("matrix"); };
  placeCraft();
  scope(root, [moon, hemi, coreLight]);
  let t0 = 0;
  return {
    root, name: "city", tower,
    look: { clear: "#060914", fog: "#1c2848", fogDensity: low ? 0.00105 : 0.00095, env: 0.45, exposure: 1.38, contrast: 1.12, glow: 0.62,
      sky: [[0, "#02040b"], [0.36, "#08102a"], [0.47, "#1d2448"], [0.5, "#3a2e3c"], [0.53, "#0a0c18"], [1, "#05060a"]] },
    update(dt, t) {
      t0 += dt; const pulse = 0.5 + 0.5 * Math.sin(t0 * 1.6), beat = Math.pow(Math.max(0, Math.sin(t0 * 1.6)), 6);
      tower.update?.(dt, beat * 0.4); tower.gold && (tower.gold.emissiveColor = C("#ffa62a").scale(0.5 + beat * 0.55));
      colM.emissiveColor.set(0.55 + pulse * 0.35, 0.55 + pulse * 0.35, 0.55 + pulse * 0.35); coreLight.intensity = 2 + beat * 1.6;
      for (const c of clouds) c.diffuseTexture.uOffset += dt * 0.002;
      for (const l of lanes) l.a += l.w * dt; placeCraft();
    }
  };
}

// ---------------------------------------------------------------- 5 · inside the train: the signal
export async function buildCabin(scene, origin, { low, high }) {
  const root = new TransformNode("set-cabin", scene); root.position.set(...origin);
  const L = 7.5, Wd = 1.6, Ht = 2.55;
  const ceilLights = [];
  for (const z of [3.5, -1.5, -5.5]) { const p = new PointLight("kLamp", new Vector3(0, 0, 0), scene); p.parent = root; p.position.set(0, 2.3, z); p.diffuse = C("#fff0d8"); p.intensity = 0.9; p.range = 6; ceilLights.push(p); }
  const hemi = new HemisphericLight("kFill", new Vector3(0, 1, 0), scene); hemi.diffuse = C("#8a8fa6"); hemi.groundColor = C("#201c1a"); hemi.intensity = 0.3;
  const dispLight = new PointLight("kDisp", new Vector3(0, 0, 0), scene); dispLight.parent = root; dispLight.position.set(0, 2.0, -6.8); dispLight.diffuse = C("#9cc6ff"); dispLight.intensity = 0.4; dispLight.range = 5;
  const panel = pbr(scene, "kPanel", "#d8d4cc", 0.55, 0.05);
  const darkM = pbr(scene, "kDark", "#22252b", 0.5, 0.3);
  const floorM = pbr(scene, "kFloor", "#2b2a2a", 0.7, 0.1);
  const seatTex = canvasTex(scene, 128, 128, (x, w, h) => { x.fillStyle = "#3a2c48"; x.fillRect(0, 0, w, h); x.fillStyle = "rgba(255,255,255,0.05)"; for (let i = 0; i < 64; i++) x.fillRect(0, i * 2, w, 1); x.fillStyle = "#c9a04e"; x.fillRect(0, 0, w, 3); }, { wrap: true, name: "seat" });
  const seatM = pbr(scene, "kSeat", "#ffffff", 0.9, 0, { albedoTexture: seatTex });
  const box = (nm, w, h, d, x, y, z, m) => { const b = CreateBox(nm, { width: w, height: h, depth: d }, scene); b.parent = root; b.position.set(x, y, z); b.material = m; return b; };
  box("kFloor", Wd * 2, 0.06, L * 2, 0, -0.03, 0, floorM);
  box("kCeil", Wd * 2, 0.06, L * 2, 0, Ht, 0, panel);
  for (const s of [-1, 1]) { box("kWallLo", 0.08, 0.95, L * 2, s * Wd, 0.475, 0, panel); box("kWallHi", 0.08, 0.6, L * 2, s * Wd, Ht - 0.3, 0, panel); box("kCove", 0.5, 0.18, L * 2, s * (Wd - 0.35), Ht - 0.12, 0, panel); }
  box("kEnd", Wd * 2, Ht, 0.1, 0, Ht / 2, -L - 0.05, darkM); box("kEnd2", Wd * 2, Ht, 0.1, 0, Ht / 2, L + 0.05, darkM);
  const stripM = unlit(scene, "kStrip", "#fff1dc", 1.6);
  for (const s of [-1, 1]) box("kLightStrip", 0.1, 0.03, L * 2 - 0.4, s * 0.45, Ht - 0.04, 0, stripM);
  const aisleM = unlit(scene, "kAisle", "#ffc27a", 0.7); box("kAisleL", 0.04, 0.01, L * 2 - 0.4, 0, 0.005, 0, aisleM);
  // windows: the night streaming past (a texture of passing lights, scrolled)
  const streak = canvasTex(scene, 1024, 64, (x, w, h) => { const R = rnd(8); x.fillStyle = "#04060b"; x.fillRect(0, 0, w, h); for (let i = 0; i < 60; i++) { const y = R() * h, len = 20 + R() * 160, g = x.createLinearGradient(0, 0, len, 0), c = R() < 0.7 ? "255,200,140" : "170,210,255"; g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(0.6, `rgba(${c},${0.3 + R() * 0.6})`); g.addColorStop(1, `rgba(${c},0)`); x.save(); x.translate(R() * w, y); x.fillStyle = g; x.fillRect(0, 0, len, 1 + R() * 2.5); x.restore(); } }, { wrap: true, name: "streak" });
  const winM = new StandardMaterial("kWinM", scene); winM.emissiveTexture = streak; winM.diffuseColor = Color3.Black(); winM.specularColor = C("#555a66"); winM.specularPower = 96;
  for (const s of [-1, 1]) { const p = CreatePlane("kWin", { width: L * 2, height: 0.95 }, scene); p.parent = root; p.material = winM; p.position.set(s * (Wd - 0.03), 1.47, 0); p.rotation.y = s * Math.PI / 2; for (let z = -L + 1.2; z < L; z += 2.2) box("kMullion", 0.06, 0.95, 0.08, s * (Wd - 0.04), 1.47, z, darkM); }
  // seats, two by two, facing forward (-z)
  const seat = CreateBox("kSeatB", { width: 0.48, height: 0.12, depth: 0.5 }, scene); seat.parent = root; seat.material = seatM;
  const back = CreateBox("kSeatK", { width: 0.48, height: 0.72, depth: 0.1 }, scene); back.parent = root; back.material = seatM;
  const head = CreateBox("kSeatH", { width: 0.34, height: 0.18, depth: 0.12 }, scene); head.parent = root; head.material = darkM;
  const ms = [], mk = [], mh = [];
  for (let z = -5.6; z < 6.5; z += 1.05) for (const x of [-1.1, -0.58, 0.58, 1.1]) { ms.push(matrixAt(x, 0.46, z, 1, 1, 1)); mk.push(matrixAt(x, 0.86, z + 0.24, 1, 1, 1)); mh.push(matrixAt(x, 1.3, z + 0.24, 1, 1, 1)); }
  thin(seat, ms); thin(back, mk); thin(head, mh);
  // the route display above the front door
  box("kDispFrame", 1.56, 0.5, 0.06, 0, 2.0, -L + 0.02, pbr(scene, "kFrame", "#c9a04e", 0.35, 1));
  const disp = new DynamicTexture("kDisplay", { width: 512, height: 160 }, scene, true); const dx = disp.getContext();
  const dispM = new StandardMaterial("kDispM", scene); dispM.emissiveTexture = disp; dispM.diffuseColor = Color3.Black(); dispM.specularColor = Color3.Black(); dispM.disableLighting = true; disp.level = 1.1;
  const dp = CreatePlane("kDispP", { width: 1.44, height: 0.42 }, scene); dp.parent = root; dp.position.set(0, 2.0, -L + 0.06); dp.material = dispM; dp.rotation.y = Math.PI;
  box("kDoor", 0.9, 2.0, 0.04, 0, 1.0, -L + 0.06, darkM);
  const ringTex = radialTex(scene, [[0, "rgba(255,210,130,0)"], [0.78, "rgba(255,210,130,0)"], [0.9, "rgba(255,215,140,0.9)"], [1, "rgba(255,200,120,0)"]], 256, "pulse");
  const pulseM = additive(scene, "kPulseM", ringTex, 1, { fogEnabled: false }); pulseM.alpha = 0;
  const pulse = CreatePlane("kPulse", { width: 1, height: 1 }, scene); pulse.parent = root; pulse.position.set(0, 2.0, -L + 0.2); pulse.rotation.y = Math.PI; pulse.material = pulseM; pulse.setEnabled(false);
  scope(root, [...ceilLights, hemi, dispLight]);

  let mode = "route", failK = 0, signalK = 0;
  const paint = (t) => {
    const w = 512, h = 160; dx.setTransform(-1, 0, 0, 1, w, 0); dx.fillStyle = "#03060c"; dx.fillRect(0, 0, w, h);
    if (mode === "route") {
      dx.strokeStyle = "rgba(140,190,255,0.5)"; dx.lineWidth = 3; dx.beginPath(); dx.moveTo(40, 100); dx.lineTo(472, 100); dx.stroke();
      const k = 0.62 + ((t * 0.01) % 0.05); dx.fillStyle = "#ffd28a"; dx.beginPath(); dx.arc(40 + k * 432, 100, 9, 0, 7); dx.fill();
      dx.fillStyle = "#9fc4ff"; for (const p of [40, 190, 330]) { dx.beginPath(); dx.arc(p, 100, 5, 0, 7); dx.fill(); }
      dx.fillStyle = "#ffcf7a"; dx.beginPath(); dx.arc(472, 100, 11, 0, 7); dx.fill();
      dx.font = "700 30px monospace"; dx.fillStyle = "#e8eefc"; dx.fillText("MJT  CORE", 342, 56); dx.font = "600 22px monospace"; dx.fillStyle = "#8fa6cc"; dx.fillText("12 MIN", 40, 56);
    } else {
      // the signal: static, then a pulse and a ring that keeps returning to «40»
      const n = 1 - Math.min(1, signalK);
      for (let i = 0; i < 260 * n + 20; i++) { dx.fillStyle = `rgba(200,210,230,${Math.random() * 0.5})`; dx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 8, 1.5); }
      if (signalK > 0) {
        const a = Math.min(1, signalK); dx.strokeStyle = `rgba(255,205,120,${a})`; dx.lineWidth = 3; dx.beginPath();
        for (let i = 0; i <= w; i += 4) { const k = i / w, env = Math.exp(-Math.pow((k - 0.5) * 5, 2)); dx.lineTo(i, 80 + Math.sin(i * 0.15 + t * 12) * 40 * env * (0.6 + 0.4 * Math.sin(t * 5))); }
        dx.stroke();
        const r = ((t * 60) % 70) + 10; dx.strokeStyle = `rgba(255,205,120,${a * (1 - r / 80)})`; dx.lineWidth = 2; dx.beginPath(); dx.arc(w / 2, 80, r, 0, 7); dx.stroke();
        dx.font = "800 64px Georgia, serif"; dx.textAlign = "center"; dx.fillStyle = `rgba(255,230,170,${a})`; dx.fillText("40", w / 2, 104);
        dx.font = '800 22px "GmDisplay", Tahoma, sans-serif'; dx.direction = "rtl"; dx.fillStyle = `rgba(255,214,150,${a * 0.9})`; dx.fillText("الطابق الأربعين", w / 2, 146); dx.direction = "ltr"; dx.textAlign = "start";
        dx.font = "600 18px monospace"; dx.fillStyle = `rgba(255,190,110,${a * 0.8})`; dx.fillText("UNKNOWN SOURCE", 16, 26); dx.fillText(((t * 7.3) % 1 > 0.5 ? "▮ " : "  ") + "40.40.40", 340, 26);
      }
    }
    disp.update(true);
  };
  paint(0);
  return {
    root, name: "cabin",
    look: { clear: "#05060a", fog: "#05060a", fogDensity: 0.0001, env: 0.2, exposure: 1.12, contrast: 1.16, glow: 0.55, sky: null },
    lightsFail() { mode = "fail"; failK = 0.0001; },
    signal() { signalK = 0.0001; pulse.setEnabled(true); },
    update(dt, t) {
      streak.uOffset += dt * 1.6;
      if (failK > 0) {
        failK = Math.min(1, failK + dt * 1.4);
        const flick = failK < 0.6 ? (Math.random() < 0.5 ? 0.15 : 1) : 0.06;
        for (const l of ceilLights) l.intensity = 0.9 * flick; stripM.emissiveColor = C("#fff1dc").scale(1.6 * flick); hemi.intensity = 0.3 * Math.max(0.25, flick);
        aisleM.emissiveColor = C("#ff9a4a").scale(0.9);
        dispLight.diffuse = C(signalK > 0 ? "#ffc070" : "#a8b4cc"); dispLight.intensity = 0.25 + (signalK > 0 ? 0.6 + Math.sin(t * 12) * 0.2 : Math.random() * 0.4);
      }
      if (signalK > 0) {
        signalK = Math.min(1.5, signalK + dt * 0.8);
        const ph = (t * 0.7) % 1; pulse.scaling.setAll(0.4 + ph * 7); pulse.position.z = -L + 0.2 + ph * 2.2; pulseM.alpha = (1 - ph) * 0.85;
        winM.emissiveColor = C("#ffcc80").scale(0.25 + 0.25 * (1 - ph)); dispLight.range = 5 + (1 - ph) * 4;
      }
      if (Math.floor(t * 20) !== Math.floor((t - dt) * 20)) paint(t);
    }
  };
}
