/* Chapter 0 — the player's apartment, forty floors above the Digital City.
 * A cut-away room (back wall with a panoramic window, two side walls, open towards the camera), furnished with CC0
 * models, lit at night by the city outside, a moon light, warm lamps, the monitor's glow and neon strips.
 * v2.89: the city is no longer a 3D skyline around the room — it is painted into the window glass with parallax
 * (world/windowview.js), so the whole GPU budget goes to the room: wood floor, wainscot, curtains, art, contact shadows.
 * The player walks with the joystick / keys or by tapping the floor; glowing markers show what can be used.
 * The computer is the MJT terminal (mining, wallet, records — the real pages); the door stays locked until chapter 1. */
import {
  Scene, PerspectiveCamera, Color, HemisphereLight, DirectionalLight, PointLight, Mesh, BoxGeometry, PlaneGeometry,
  MeshStandardMaterial, MeshBasicMaterial, Group, Vector3, Raycaster, Vector2, CanvasTexture, RepeatWrapping,
  SRGBColorSpace, OctahedronGeometry, RingGeometry, AdditiveBlending, PMREMGenerator, DoubleSide
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { windowMaterial } from "../world/windowview.js";
import { place, strip, liveScreen } from "../world/props.js";
import { loadCharacter, Player } from "../world/player.js";
import { PALETTE, ASSET, charById } from "../config.js";
import { t, tl, fill } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";
import { openPause } from "../ui/menus.js";
import { CHAPTER0 as C } from "../story/chapter0.js";

const W = 4, D = 3, H = 3, TH = 0.16; // half width (x), half depth (z), wall height, wall thickness
const WIN = { x0: -1.7, x1: 1.7, y0: 0.75, y1: 2.65 };
const DOOR = { z0: 1.0, z1: 2.1, h: 2.2 };

/** warm oak planks: per-plank tone, long grain lines, knots, dark seams; a matching roughness map (seams matte, wood satin) */
function floorTextures(n = 1024) {
  const cv = document.createElement("canvas"); cv.width = cv.height = n; const x = cv.getContext("2d");
  const rc = document.createElement("canvas"); rc.width = rc.height = n / 2; const r = rc.getContext("2d");
  r.fillStyle = "#5a5a5a"; r.fillRect(0, 0, n / 2, n / 2);
  const rows = 8, ph = n / rows, tones = ["#6b4a33", "#74513a", "#5f412d", "#7a5840", "#684733", "#704d36"];
  for (let i = 0; i < rows; i++) {
    const y = i * ph; let xx = -((i * 397) % n);
    while (xx < n) {
      const len = n * (0.45 + ((i * 7 + Math.floor(xx)) % 5) * 0.08);
      x.fillStyle = tones[(i * 3 + Math.abs(Math.floor(xx / 50))) % tones.length]; x.fillRect(xx, y, len, ph);
      // grain
      for (let g = 0; g < 26; g++) { const gy = y + Math.random() * ph; x.strokeStyle = `rgba(${Math.random() < 0.5 ? "40,24,14" : "150,110,80"},${0.08 + Math.random() * 0.12})`; x.lineWidth = 0.6 + Math.random() * 1.4; x.beginPath(); x.moveTo(xx, gy); for (let s = 0; s <= 8; s++) x.lineTo(xx + (len * s) / 8, gy + Math.sin(s * 1.3 + g) * 1.6); x.stroke(); }
      if (Math.random() < 0.35) { const kx = xx + Math.random() * len, ky = y + ph * (0.3 + Math.random() * 0.4); const kg = x.createRadialGradient(kx, ky, 0, kx, ky, ph * 0.18); kg.addColorStop(0, "rgba(35,20,10,.75)"); kg.addColorStop(1, "rgba(35,20,10,0)"); x.fillStyle = kg; x.fillRect(kx - ph * 0.3, ky - ph * 0.3, ph * 0.6, ph * 0.6); }
      x.fillStyle = "#24160d"; x.fillRect(xx, y, 2, ph); r.fillStyle = "#c8c8c8"; r.fillRect(xx / 2, y / 2, 1.5, ph / 2);
      xx += len;
    }
    x.fillStyle = "#1e120a"; x.fillRect(0, y, n, 2.5); r.fillStyle = "#d0d0d0"; r.fillRect(0, y / 2, n / 2, 1.5);
    const sh = x.createLinearGradient(0, y, 0, y + ph); sh.addColorStop(0, "rgba(255,230,200,.05)"); sh.addColorStop(1, "rgba(0,0,0,.08)"); x.fillStyle = sh; x.fillRect(0, y, n, ph);
  }
  const t = new CanvasTexture(cv); t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(2, 2); t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
  const rt = new CanvasTexture(rc); rt.wrapS = rt.wrapT = RepeatWrapping; rt.repeat.set(2, 2);
  return { map: t, rough: rt };
}
/** soft dark blob used as a contact shadow under furniture */
function blobTexture() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128; const x = cv.getContext("2d");
  const g = x.createRadialGradient(64, 64, 8, 64, 64, 64); g.addColorStop(0, "rgba(0,0,0,.75)"); g.addColorStop(0.55, "rgba(0,0,0,.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new CanvasTexture(cv);
}
/** a fabric curtain: vertical folds with light and shadow */
function curtainTexture() {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 32; const x = cv.getContext("2d");
  const g = x.createLinearGradient(0, 0, 256, 0); for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, i % 2 ? "#3b1d4f" : "#5a2d73"); x.fillStyle = g; x.fillRect(0, 0, 256, 32);
  const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; return t;
}
/** framed art: a small synthwave sunset or an abstract MJT print */
function artTexture(kind) {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 320; const x = cv.getContext("2d");
  if (kind === 0) {
    const g = x.createLinearGradient(0, 0, 0, 320); g.addColorStop(0, "#1a0b3d"); g.addColorStop(0.55, "#c2367a"); g.addColorStop(0.62, "#ffb347"); g.addColorStop(0.62, "#14082a"); g.addColorStop(1, "#05020d"); x.fillStyle = g; x.fillRect(0, 0, 256, 320);
    x.fillStyle = "#ffd36b"; x.beginPath(); x.arc(128, 190, 60, Math.PI, 0); x.fill(); x.fillStyle = "#1a0b3d"; for (let i = 0; i < 5; i++) x.fillRect(60, 150 + i * 9, 136, 3 + i);
    x.strokeStyle = "#ff3fb4"; x.lineWidth = 2; for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(128, 200); x.lineTo(-200 + i * 93, 320); x.stroke(); } for (let i = 0; i < 6; i++) { const y = 205 + i * i * 4; x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke(); }
  } else {
    x.fillStyle = "#0d1426"; x.fillRect(0, 0, 256, 320);
    x.strokeStyle = "#ffc23d"; x.lineWidth = 10; x.beginPath(); x.arc(128, 150, 80, 0, Math.PI * 2); x.stroke();
    x.fillStyle = "#2fe6ff"; x.font = "bold 70px sans-serif"; x.textAlign = "center"; x.fillText("MJT", 128, 175);
    x.fillStyle = "rgba(255,255,255,.5)"; x.font = "16px sans-serif"; x.fillText("MUJTAMA COIN", 128, 285);
  }
  const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; return t;
}
/** the void around the diorama: a soft navy radial glow, darker at the edges */
function voidTexture() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 512; const x = cv.getContext("2d");
  const g = x.createRadialGradient(256, 230, 20, 256, 256, 360); g.addColorStop(0, "#1a1d3a"); g.addColorStop(0.6, "#0a0b1c"); g.addColorStop(1, "#020208");
  x.fillStyle = g; x.fillRect(0, 0, 512, 512); const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; return t;
}
function wallTexture() {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 256; const x = cv.getContext("2d");
  // warm plaster with a fine trowel texture
  x.fillStyle = "#3a3550"; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { const l = Math.random() < 0.5; x.fillStyle = `rgba(${l ? "255,240,230" : "0,0,0"},${Math.random() * (l ? 0.035 : 0.07)})`; x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  const t = new CanvasTexture(cv); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; return t;
}

export async function create(game, params = {}) {
  const save = game.save.data || {}; const name = save.name || "";
  const scene = new Scene(); scene.background = voidTexture();
  const camera = new PerspectiveCamera(46, 1, 0.1, 1500);
  const q = game.renderer.q;
  // soft reflections for the furniture (very low, the night stays dark)
  const pm = new PMREMGenerator(game.renderer.gl); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.18; pm.dispose();


  // ---------- the room ----------
  const room = new Group(); scene.add(room);
  const wallMat = new MeshStandardMaterial({ map: wallTexture(), color: 0xd8d0ee, roughness: 0.92, metalness: 0 });
  const ft = floorTextures(q.dpr > 1 ? 1024 : 512);
  const floor = new Mesh(new PlaneGeometry(W * 2, D * 2), new MeshStandardMaterial({ map: ft.map, roughnessMap: ft.rough, roughness: 0.8, metalness: 0.02, color: 0xd2b8a4 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor);
  // the diorama base: a thick slab under the floor with a thin gold edge, so the room reads as a crafted model
  const slab = new Mesh(new BoxGeometry(W * 2 + TH * 2 + 0.2, 0.5, D * 2 + TH + 0.2), new MeshStandardMaterial({ color: 0x14121f, roughness: 0.6, metalness: 0.3 }));
  slab.position.set(0, -0.251, -TH / 2); room.add(slab);
  room.add(strip(new Vector3(-W - TH - 0.1, -0.02, D + 0.1), new Vector3(W + TH + 0.1, -0.02, D + 0.1), PALETTE.gold, 1.4, 0.02));
  const wall = (w, h, d, x, y, z, rep = [1, 1]) => { const m = wallMat.clone(); m.map = wallMat.map.clone(); m.map.needsUpdate = true; m.map.repeat.set(rep[0], rep[1]); const o = new Mesh(new BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.receiveShadow = true; o.castShadow = true; room.add(o); return o; };
  // back wall around the window
  const bz = -D - TH / 2;
  wall(WIN.x0 + W, H, TH, (-W + WIN.x0) / 2, H / 2, bz, [1.2, 1]);
  wall(W - WIN.x1, H, TH, (W + WIN.x1) / 2, H / 2, bz, [1.2, 1]);
  wall(WIN.x1 - WIN.x0, WIN.y0, TH, (WIN.x0 + WIN.x1) / 2, WIN.y0 / 2, bz, [1, 0.3]);
  wall(WIN.x1 - WIN.x0, H - WIN.y1, TH, (WIN.x0 + WIN.x1) / 2, (H + WIN.y1) / 2, bz, [1, 0.2]);
  // left wall (low towards the camera so it never hides the player)
  wall(TH, H, D * 2, -W - TH / 2, H / 2, 0, [1.6, 1]);
  // right wall with the door
  const rx = W + TH / 2;
  wall(TH, H, DOOR.z0 + D, rx, H / 2, (-D + DOOR.z0) / 2, [1.2, 1]);
  wall(TH, H, D - DOOR.z1, rx, H / 2, (D + DOOR.z1) / 2, [0.4, 1]);
  wall(TH, H - DOOR.h, DOOR.z1 - DOOR.z0, rx, (H + DOOR.h) / 2, (DOOR.z0 + DOOR.z1) / 2, [0.3, 0.2]);
  // the door itself + its status light
  const door = new Mesh(new BoxGeometry(0.06, DOOR.h, DOOR.z1 - DOOR.z0), new MeshStandardMaterial({ color: 0x2a2f4d, roughness: 0.4, metalness: 0.6 }));
  door.position.set(W - 0.02, DOOR.h / 2, (DOOR.z0 + DOOR.z1) / 2); room.add(door);
  const doorLed = strip(new Vector3(W - 0.07, 0.25, DOOR.z0 + 0.12), new Vector3(W - 0.07, DOOR.h - 0.25, DOOR.z0 + 0.12), PALETTE.red, 3.5, 0.03); room.add(doorLed);
  const doorPad = new Mesh(new PlaneGeometry(0.16, 0.24), new MeshBasicMaterial({ color: new Color(PALETTE.red).multiplyScalar(2) })); doorPad.position.set(W - 0.09, 1.25, DOOR.z0 - 0.22); doorPad.rotation.y = -Math.PI / 2; room.add(doorPad);
  // window: frame, mullions, rain on the glass
  const frameM = new MeshStandardMaterial({ color: 0x0c0e1a, roughness: 0.4, metalness: 0.7 });
  const bar = (w, h, x, y) => { const m = new Mesh(new BoxGeometry(w, h, 0.08), frameM); m.position.set(x, y, -D - 0.02); room.add(m); };
  bar(WIN.x1 - WIN.x0 + 0.1, 0.07, 0, WIN.y0); bar(WIN.x1 - WIN.x0 + 0.1, 0.07, 0, WIN.y1); bar(0.06, WIN.y1 - WIN.y0, 0, (WIN.y0 + WIN.y1) / 2);
  bar(0.06, WIN.y1 - WIN.y0, WIN.x0 + (WIN.x1 - WIN.x0) / 4, (WIN.y0 + WIN.y1) / 2); bar(0.06, WIN.y1 - WIN.y0, WIN.x1 - (WIN.x1 - WIN.x0) / 4, (WIN.y0 + WIN.y1) / 2);
  const glass = new Mesh(new PlaneGeometry(WIN.x1 - WIN.x0, WIN.y1 - WIN.y0), windowMaterial({ hi: q.dpr > 1 }));
  glass.position.set(0, (WIN.y0 + WIN.y1) / 2, -D - 0.03); room.add(glass);
  const sill = new Mesh(new BoxGeometry(WIN.x1 - WIN.x0 + 0.3, 0.05, 0.3), frameM); sill.position.set(0, WIN.y0 - 0.01, -D + 0.12); room.add(sill);

  // neon: ceiling-edge strips (cyan), baseboard (gold), window outline (magenta)
  room.add(strip(new Vector3(-W + 0.05, H - 0.06, -D + 0.05), new Vector3(W - 0.05, H - 0.06, -D + 0.05), PALETTE.cyan, 2.6));
  room.add(strip(new Vector3(-W + 0.05, H - 0.06, -D + 0.05), new Vector3(-W + 0.05, H - 0.06, D), PALETTE.cyan, 2.6));
  room.add(strip(new Vector3(W - 0.05, H - 0.06, -D + 0.05), new Vector3(W - 0.05, H - 0.06, D), PALETTE.cyan, 2.6));
  room.add(strip(new Vector3(-W + 0.03, 0.04, -D + 0.03), new Vector3(W - 0.03, 0.04, -D + 0.03), PALETTE.gold, 1.6, 0.025));
  room.add(strip(new Vector3(-W + 0.03, 0.04, -D + 0.03), new Vector3(-W + 0.03, 0.04, D), PALETTE.gold, 1.6, 0.025));
  room.add(strip(new Vector3(WIN.x0, WIN.y1 + 0.06, -D + 0.06), new Vector3(WIN.x1, WIN.y1 + 0.06, -D + 0.06), PALETTE.magenta, 2.4, 0.03));

  // ---------- finishing: wainscot, chair rail, wall caps, curtains, art ----------
  const wainM = new MeshStandardMaterial({ color: 0x1d1a2c, roughness: 0.55, metalness: 0.1 });
  const trimM = new MeshStandardMaterial({ color: 0x0f0d18, roughness: 0.35, metalness: 0.5 });
  const slabAt = (w, h, d, x, y, z, m) => { const o = new Mesh(new BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.receiveShadow = true; room.add(o); return o; };
  // lower panelling on the back wall (either side of the window) and the left wall, with vertical panel grooves
  const WH = 0.85;
  slabAt(W + WIN.x0 - 0.02, WH, 0.03, (-W + WIN.x0) / 2, WH / 2, -D + 0.015, wainM);
  slabAt(W - WIN.x1 - 0.02, WH, 0.03, (W + WIN.x1) / 2, WH / 2, -D + 0.015, wainM);
  slabAt(0.03, WH, D * 2, -W + 0.015, WH / 2, 0, wainM);
  for (let gx = -W + 0.5; gx < W; gx += 0.5) if (gx < WIN.x0 - 0.05 || gx > WIN.x1 + 0.05) slabAt(0.015, WH - 0.12, 0.01, gx, WH / 2, -D + 0.035, trimM);
  for (let gz = -D + 0.5; gz < D; gz += 0.5) slabAt(0.01, WH - 0.12, 0.015, -W + 0.035, WH / 2, gz, trimM);
  slabAt(W * 2, 0.04, 0.05, 0, WH, -D + 0.025, trimM); slabAt(0.05, 0.04, D * 2, -W + 0.025, WH, 0, trimM);
  // crown caps on top of the cut-away walls (the walls read as solid, not paper)
  const capM = new MeshStandardMaterial({ color: 0x0b0a12, roughness: 0.4, metalness: 0.4 });
  slabAt(W * 2 + TH * 2, 0.04, TH + 0.02, 0, H + 0.02, -D - TH / 2, capM);
  slabAt(TH + 0.02, 0.04, D * 2 + TH, -W - TH / 2, H + 0.02, -TH / 2, capM);
  slabAt(TH + 0.02, 0.04, D * 2 + TH, W + TH / 2, H + 0.02, -TH / 2, capM);
  // curtains gathered at both sides of the window, on a thin rod
  const curM = new MeshStandardMaterial({ map: curtainTexture(), roughness: 0.95, side: DoubleSide });
  for (const cx of [WIN.x0 - 0.22, WIN.x1 + 0.22]) { const c = new Mesh(new BoxGeometry(0.5, WIN.y1 - WIN.y0 + 0.45, 0.06), curM); c.position.set(cx, (WIN.y0 + WIN.y1) / 2 + 0.1, -D + 0.1); c.castShadow = true; room.add(c); }
  slabAt(WIN.x1 - WIN.x0 + 1.2, 0.025, 0.025, 0, WIN.y1 + 0.28, -D + 0.12, trimM);
  // framed art on the back wall, between the window and the corners
  const artFrame = (kind, x, y, w, h) => { slabAt(w + 0.07, h + 0.07, 0.035, x, y, -D + 0.02, trimM); const a = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ map: artTexture(kind), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.12, emissiveMap: null })); a.material.emissiveMap = a.material.map; a.position.set(x, y, -D + 0.04); room.add(a); };
  artFrame(0, -2.95, 1.75, 0.62, 0.78); artFrame(1, 3.0, 1.85, 0.5, 0.62);

  // ---------- lights ----------
  scene.add(new HemisphereLight(0x4a4f8a, 0x1a1210, 0.5));
  const moon = new DirectionalLight(0x9db2ff, 0.85); moon.position.set(-3, 9, -12); moon.target.position.set(0, 0, 0);
  if (q.shadows) { moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); Object.assign(moon.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 }); moon.shadow.bias = -0.0008; moon.shadow.normalBias = 0.03; }
  scene.add(moon, moon.target);
  const cityGlow = new PointLight(0xa685ff, 4, 9, 1.6); cityGlow.position.set(0, 1.8, -2.2); scene.add(cityGlow);

  // ---------- furniture (CC0 Kenney Furniture Kit) ----------
  const colliders = [], add = (o) => { room.add(o); if (o.solid) colliders.push(o.box); return o; };
  const items = await Promise.all([
    place("bedDouble", { x: -3.1, z: -1.95, size: 2.05 }),
    place("cabinetBedDrawerTable", { x: -1.85, z: -2.7, size: 0.5 }),
    place("lampSquareTable", { x: -1.85, z: -2.72, y: 0.48, height: 0.42, solid: false }),
    place("desk", { x: 3.35, z: -1.55, size: 1.5, rot: -Math.PI / 2 }),
    place("chairDesk", { x: 2.45, z: -1.5, size: 0.62, rot: Math.PI / 2 }),
    place("computerScreen", { x: 3.62, z: -1.55, y: 0.76, size: 0.7, rot: -Math.PI / 2, solid: false }),
    place("computerKeyboard", { x: 3.25, z: -1.55, y: 0.76, size: 0.46, rot: -Math.PI / 2, solid: false }),
    place("bookcaseOpenLow", { x: 2.75, z: -2.72, size: 0.95 }),
    place("books", { x: 2.6, z: -2.72, y: 0.46, size: 0.3, solid: false }),
    place("speaker", { x: 3.72, z: -2.72, height: 1.05 }),
    place("pottedPlant", { x: 1.95, z: -2.72, height: 1.15 }),
    place("loungeDesignSofa", { x: -3.55, z: 1.15, size: 1.95, rot: Math.PI / 2 }),
    place("tableCoffeeGlass", { x: -2.35, z: 1.15, size: 1.05, rot: Math.PI / 2 }),
    place("lampRoundFloor", { x: -3.65, z: 2.55, height: 1.65 }),
    place("plantSmall2", { x: -2.35, z: 1.0, y: 0.38, height: 0.32, solid: false }),
    place("rugRounded", { x: -0.2, z: 0.4, size: 2.8, solid: false }),
    place("cardboardBoxClosed", { x: 3.35, z: 2.55, size: 0.55 }),
    place("cardboardBoxOpen", { x: 2.65, z: 2.65, size: 0.62 }),
    place("cardboardBoxClosed", { x: 3.4, z: 2.6, y: 0.62, size: 0.45, rot: 0.4, solid: false })
  ]).catch((e) => { console.error(e); return []; });
  items.forEach(add);
  // contact shadows: a soft dark blob under every solid piece grounds it on the floor (cheap ambient occlusion)
  const blobT = blobTexture(), blobM = new MeshBasicMaterial({ map: blobT, transparent: true, depthWrite: false, opacity: 0.85 });
  for (const it of items) { if (!it.solid) continue; const b = it.box, w = b.max.x - b.min.x, d = b.max.z - b.min.z; const s = new Mesh(new PlaneGeometry(w * 1.35, d * 1.35), blobM); s.rotation.x = -Math.PI / 2; s.position.set((b.min.x + b.max.x) / 2, 0.004, (b.min.z + b.max.z) / 2); room.add(s); }
  // a soft cyan LED under the desk
  room.add(strip(new Vector3(3.0, 0.7, -2.2), new Vector3(3.0, 0.7, -0.9), PALETTE.cyan, 2, 0.02));
  // the bed gets a magenta glow underneath; the lamps their warm light
  room.add(strip(new Vector3(-4, 0.06, -0.92), new Vector3(-2.1, 0.06, -0.92), PALETTE.magenta, 2.2, 0.03));
  const lampL = new PointLight(0xffa860, 4.5, 5, 1.8); lampL.position.set(-1.85, 1.0, -2.6); scene.add(lampL);
  const lampF = new PointLight(0xffc285, 3.2, 5, 2); lampF.position.set(-3.6, 1.6, 2.45); scene.add(lampF);

  // the monitor: a live MJT miner screen (real mining state)
  let mining = null;
  game.host.api("GET", "/api/mjt/mining").then((m) => { mining = m; }).catch(() => { mining = null; });
  const scr = liveScreen(256, 160, (x, w, h, time) => {
    x.fillStyle = "#020812"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#2fe6ff"; x.font = "bold 15px monospace"; x.fillText("MJT MINER v1.0", 12, 22);
    x.fillStyle = "rgba(47,230,255,.35)"; x.fillRect(12, 30, w - 24, 1);
    const s = mining?.session; let p = 0, label = "IDLE — PRESS START";
    if (s) { const a = Date.parse(s.startedAt), b = Date.parse(s.endsAt); p = Math.min(1, Math.max(0, (Date.now() - a) / (b - a))); label = s.ready ? "CYCLE COMPLETE — CLAIM" : "MINING  " + (p * 100).toFixed(2) + "%"; }
    else if (!game.member) label = "SIGN IN TO MINE";
    x.fillStyle = "#ffc23d"; x.font = "bold 13px monospace"; x.fillText(label, 12, 54);
    x.strokeStyle = "#ffc23d"; x.strokeRect(12, 66, w - 24, 14); x.fillStyle = "#ffc23d"; x.fillRect(14, 68, (w - 28) * p, 10);
    x.fillStyle = "rgba(47,230,255,.8)"; x.font = "11px monospace";
    for (let i = 0; i < 4; i++) { const n = Math.floor(time * 6 + i * 13); x.fillText("0x" + ((n * 2654435761) >>> 0).toString(16).padStart(8, "0") + "  ✓", 12, 100 + i * 14); }
    if (Math.floor(time * 2) % 2) { x.fillStyle = "#2fe6ff"; x.fillRect(12, 148, 8, 3); }
  });
  const screen = new Mesh(new PlaneGeometry(0.62, 0.38), new MeshBasicMaterial({ map: scr.tex, color: new Color(1.6, 1.6, 1.6), toneMapped: true }));
  screen.position.set(3.575, 1.04, -1.55); screen.rotation.y = -Math.PI / 2; room.add(screen);
  const monGlow = new PointLight(PALETTE.cyan, 4, 3.5, 1.6); monGlow.position.set(3.1, 1.15, -1.55); scene.add(monGlow);

  // the city board: a holographic news panel on the left wall
  const news = liveScreen(512, 256, (x, w, h, time) => {
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#160a33"); g.addColorStop(1, "#04121f"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(255,63,180,.9)"; x.lineWidth = 4; x.strokeRect(6, 6, w - 12, h - 12);
    x.direction = "rtl"; x.textAlign = "center"; x.fillStyle = "#ffc23d"; x.font = "bold 44px sans-serif"; x.fillText(t("المدينة الرقمية", "THE DIGITAL CITY"), w / 2, 70);
    x.fillStyle = "#eaf2ff"; x.font = "28px sans-serif"; x.fillText(fill(t("مرحباً {name}", "Welcome, {name}"), { name }), w / 2, 120);
    x.fillStyle = "#2fe6ff"; x.font = "bold 26px sans-serif"; const msg = [t("النواة تصدر MJT كل يوم", "The Core issues MJT daily"), t("التعدين: 5 MJT كل 24 ساعة", "Mining: 5 MJT every 24h"), t("قريباً: مجمّع التعدين والمتجر", "Soon: Mining Complex & Market")][Math.floor(time / 3.5) % 3];
    x.fillText(msg, w / 2, 190);
    x.fillStyle = "rgba(255,255,255,.06)"; for (let yy = (time * 40) % 6; yy < h; yy += 6) x.fillRect(0, yy, w, 2);
  });
  const panel = new Mesh(new PlaneGeometry(1.7, 0.85), new MeshBasicMaterial({ map: news.tex, color: new Color(1.5, 1.5, 1.5), transparent: true, opacity: 0.95, side: DoubleSide }));
  scr.tick(0); news.tick(0);
  panel.position.set(-W + 0.03, 1.9, -0.05); panel.rotation.y = Math.PI / 2; room.add(panel);

  // ---------- interactables ----------
  const done = (k) => !!game.save.flag("room." + k);
  const things = [
    { id: "window", at: new Vector3(0, 0, -2.25), mark: new Vector3(0, 2.0, -2.7), face: new Vector3(0, 0, -3) },
    { id: "computer", at: new Vector3(2.55, 0, -0.95), mark: new Vector3(3.5, 1.55, -1.55), face: new Vector3(3.6, 0, -1.55) },
    { id: "door", at: new Vector3(3.3, 0, 1.55), mark: new Vector3(3.85, 2.45, 1.55), face: new Vector3(4, 0, 1.55) },
    { id: "boxes", at: new Vector3(2.55, 0, 1.9), mark: new Vector3(3.0, 1.3, 2.6), face: new Vector3(3.1, 0, 2.6) },
    { id: "bed", at: new Vector3(-1.75, 0, -1.6), mark: new Vector3(-3.0, 1.0, -1.9), face: new Vector3(-3, 0, -1.9) },
    { id: "panel", at: new Vector3(-2.9, 0, -0.05), mark: new Vector3(-3.7, 2.55, -0.05), face: new Vector3(-4, 0, -0.05) }
  ];
  const markGeo = new OctahedronGeometry(0.11, 0), haloGeo = new RingGeometry(0.3, 0.36, 40);
  for (const th of things) {
    const goal = C.goals.includes(th.id);
    const col = goal ? PALETTE.gold : PALETTE.cyan;
    th.m = new Mesh(markGeo, new MeshBasicMaterial({ color: new Color(col).multiplyScalar(3) })); th.m.position.copy(th.mark); room.add(th.m);
    th.h = new Mesh(haloGeo, new MeshBasicMaterial({ color: new Color(col).multiplyScalar(2.2), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false })); th.h.rotation.x = -Math.PI / 2; th.h.position.set(th.at.x, 0.02, th.at.z); room.add(th.h);
    th.hit = new Mesh(new BoxGeometry(1.1, 1.8, 1.1), new MeshBasicMaterial({ visible: false })); th.hit.position.set(th.mark.x, 0.9, th.mark.z); th.hit.userData.thing = th; room.add(th.hit);
    th.goal = goal;
  }

  // ---------- the player ----------
  const ch = await loadCharacter(save.char || "hoodie", 1.72);
  const player = new Player(ch, game.audio); player.addTo(scene);
  const pos = save.pos && !params.arrival ? save.pos : { x: -0.4, z: 0.9, r: Math.PI };
  player.pos.set(pos.x, 0, pos.z); player.heading = pos.r ?? Math.PI;
  const world = { colliders, bounds: { minX: -W + 0.05, maxX: W - 0.05, minZ: -D + 0.05, maxZ: D - 0.1 } };

  // ---------- HUD ----------
  const c0 = charById(save.char);
  const L = game.ui.layer(`
    <header class="gm-hud-top">
      <div class="gm-plate"><img src="${ASSET(`chars/${c0.id}.webp`)}" alt="" width="44" height="44" decoding="async"><div><b>${esc(name)}</b><span>${esc(t("المستوى", "Level"))} ${save.level || 1}</span><i class="gm-xp"><i></i></i></div></div>
      <div class="gm-hud-end">
        <a class="gm-coin" href="#/city/mjt/balance" aria-label="${esc(t("رصيدك من مجتمع كوين", "Your Mujtama Coin balance"))}">${icon("coin")}<bdi id="gm-bal">…</bdi><small>MJT</small></a>
        <button type="button" class="gm-ico" id="gm-menu" aria-label="${esc(t("القائمة", "Menu"))}">${icon("menu")}</button>
      </div>
    </header>
    <section class="gm-obj" id="gm-obj" hidden><span class="gm-obj-k">${esc(tl(C.title))} · ${esc(tl(C.name))}</span><b>${esc(tl(C.objective))}</b><ul>${C.goals.map((g) => `<li data-g="${g}">${icon("check")}<span>${esc(tl(C.goalLabel[g]))}</span></li>`).join("")}</ul></section>
    <p class="gm-help" id="gm-help">${esc(game.input.touch ? t("المس الأرض لتمشي · استخدم الإبهام الأيسر للتحكم", "Tap the floor to walk · left thumb to steer") : t("WASD أو الأسهم للتحرك · E للتفاعل · Esc للقائمة", "WASD / arrows to move · E to interact · Esc for menu"))}</p>
    <button type="button" class="gm-act" id="gm-act" hidden data-sfx="click"><span class="gm-act-i">${icon("hand")}</span><span class="gm-act-t"><small id="gm-act-k"></small><b id="gm-act-v"></b></span></button>
    <div class="gm-card" id="gm-card" hidden><small></small><b></b></div>`, "gm-room");
  const $ = (s) => L.querySelector(s);
  const paintObj = () => { for (const li of L.querySelectorAll("[data-g]")) li.classList.toggle("ok", done(li.dataset.g)); };
  const refreshBal = () => { if (!game.member) { $("#gm-bal").textContent = "—"; return; } game.host.api("GET", "/api/mjt/me").then((m) => { $("#gm-bal").textContent = String(m.balance.mjt); }, () => { $("#gm-bal").textContent = "—"; }); };
  refreshBal(); paintObj();
  $("#gm-menu").addEventListener("click", () => openPause(game));
  game.input.on("pause", () => { if (game.scenes.name === "room" && !game.ui.modalOpen && !busy) openPause(game); });

  // ---------- interaction ----------
  let near = null, busy = false, cine = null, helpGone = false;
  const label = (th) => C.things[th.id];
  const showAct = (th) => { const a = $("#gm-act"); if (!th) { a.hidden = true; return; } $("#gm-act-k").textContent = tl(label(th).label); $("#gm-act-v").textContent = tl(label(th).verb); a.hidden = false; a.dataset.goal = th.goal ? "1" : ""; };
  const lines = (arr) => arr.map((l) => fill(tl(l), { name }));
  async function use(th) {
    if (busy) return; busy = true; showAct(null); player.walkTo(null); player.face(th.face.x, th.face.z);
    try {
      if (th.id === "window") {
        cine = { from: camera.position.clone(), to: new Vector3(0.4, 1.75, -1.1), look: new Vector3(0, 1.9, -30), k: 0 };
        game.audio.sfx("whoosh"); await new Promise((r) => setTimeout(r, 900));
        await game.ui.dialog(lines(C.things.window.lines), tl(C.narrator)); cine = null;
      } else if (th.id === "computer") {
        await player.gesture("Interact");
        if (!done("computer")) await game.ui.dialog(lines(C.things.computer.first), tl(C.narrator));
        mark("computer"); terminal(); busy = false; return;
      } else if (th.id === "door") {
        game.audio.sfx("locked"); doorPad.material.color.setRGB(4, 0.4, 0.6); await player.gesture("Interact");
        await game.ui.dialog(lines(C.things.door.lines), tl(C.narrator)); doorPad.material.color.copy(new Color(PALETTE.red).multiplyScalar(2));
      } else {
        await game.ui.dialog(lines(C.things[th.id].lines), tl(C.narrator));
      }
      mark(th.id);
    } finally { busy = false; }
  }
  function mark(id) {
    if (!C.goals.includes(id) && id !== "boxes" && id !== "bed" && id !== "panel") return;
    if (done(id)) return;
    game.save.set({ flags: { ["room." + id]: true } });
    if (C.goals.includes(id)) { game.audio.sfx("ping"); paintObj(); if (C.goals.every(done) && !done("done")) setTimeout(finale, 600); }
  }
  async function finale() {
    if (busy) return setTimeout(finale, 800);
    busy = true; game.save.set({ flags: { "room.done": true } }); game.audio.sfx("reveal");
    card(tl(C.title) + " · " + tl(C.name), t("اكتمل", "Complete"));
    await player.gesture("Cheer"); await game.ui.dialog(lines(C.done), tl(C.narrator));
    doorLed.material.color.copy(new Color(PALETTE.gold).multiplyScalar(3)); busy = false;
  }
  function card(k, v) { const c = $("#gm-card"); c.querySelector("small").textContent = k; c.querySelector("b").textContent = v; c.hidden = false; c.classList.remove("on"); void c.offsetWidth; c.classList.add("on"); setTimeout(() => { c.hidden = true; }, 3600); }
  function terminal() {
    const s = mining?.session;
    let status = t("جهاز التعدين متوقف — ابدأ دورة جديدة", "The miner is idle — start a new cycle");
    if (!game.member) status = t("سجّل الدخول لتبدأ التعدين", "Sign in to start mining");
    else if (s?.ready) status = t("اكتملت الدورة — استلم أرباحك", "Cycle complete — claim your coins");
    else if (s) { const left = Math.max(0, Date.parse(s.endsAt) - Date.now()), hh = Math.floor(left / 3600e3), mm = Math.floor(left / 60e3) % 60; status = fill(t("يعدّن الآن — متبقٍ {h}س {m}د", "Mining — {h}h {m}m left"), { h: hh, m: mm }); }
    const opt = (id, ic, l, d) => `<button type="button" class="gm-term-o" data-st="${id}">${icon(ic)}<span><b>${esc(l)}</b><small>${esc(d)}</small></span></button>`;
    const p = game.ui.modal(`
      <header class="gm-ph term">${icon("chip")}<h2>${esc(t("طرفية مجتمع كوين", "Mujtama Coin terminal"))}</h2><button type="button" class="gm-ico" data-a="x" aria-label="${esc(t("إغلاق", "Close"))}" data-sfx="back">${icon("x")}</button></header>
      <p class="gm-term-s ${s ? (s.ready ? "ready" : "run") : ""}">${esc(status)}</p>
      <div class="gm-term">
        ${opt("earn", "spark", t("التعدين", "Mining"), t("دورة 24 ساعة · 5 MJT", "24-hour cycle · 5 MJT"))}
        ${opt("send", "wallet", t("المحفظة", "Wallet"), t("أرسل واستقبل", "Send and receive"))}
        ${opt("balance", "coin", t("الرصيد", "Balance"), t("رصيدك ومكافآت اليوم", "Your balance and today's rewards"))}
        ${opt("history", "list", t("السجلات", "Records"), t("كل حركة", "Every movement"))}
        ${opt("stats", "chart", t("الإحصاءات", "Stats"), t("من أين يأتي رصيدك", "Where your coins come from"))}
      </div>`, "gm-termm");
    p.addEventListener("click", (e) => {
      const st = e.target.closest("[data-st]")?.dataset.st; if (st) { game.ui.closeModal(); game.openStation(st); return; }
      if (e.target.closest("[data-a=x]")) game.ui.closeModal();
    });
    p.querySelector(".gm-term-o")?.focus();
  }
  $("#gm-act").addEventListener("click", () => { if (near) use(near); });
  game.input.on("action", () => { if (game.scenes.name === "room" && near && !busy && !game.ui.modalOpen) use(near); });
  // taps: on a thing → walk there and use it; on the floor → walk there
  const ray = new Raycaster(), ndc = new Vector2(), hits = [floor, ...things.map((x) => x.hit)];
  let pending = null;
  game.input.on("tap", (p) => {
    if (busy || game.ui.modalOpen || game.scenes.name !== "room") return;
    ndc.set(p.x, p.y); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hits, false)[0]; if (!hit) return;
    const th = hit.object.userData.thing;
    if (th) { pending = th; player.walkTo(th.at); }
    else { pending = null; player.walkTo(hit.point); }
    hideHelp();
  });
  player.onArrive = () => { if (pending) { const th = pending; pending = null; use(th); } };
  const hideHelp = () => { if (helpGone) return; helpGone = true; $("#gm-help").classList.add("gone"); };

  // camera: a three-quarter follow camera that keeps the whole room readable
  const camT = new Vector3(), camP = new Vector3();
  const frame = () => { camera.fov = camera.aspect < 0.8 ? 58 : 46; camera.updateProjectionMatrix(); };
  game.renderer.onResize = frame;
  const goalCam = () => {
    // narrow screens: back off until ~2.9 m either side of the target fits the horizontal field of view, and follow the
    // player sideways more closely so the part of the room that matters is always in frame
    const portrait = camera.aspect < 0.8, halfH = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const dist = portrait ? Math.min(12, Math.max(8.6, 2.9 / Math.tan(halfH))) : 7.4, hgt = portrait ? dist * 0.78 : 6.0;
    const tx = Math.max(-1.6, Math.min(1.6, player.pos.x * (portrait ? 0.8 : 0.55))), tz = Math.max(-1.4, Math.min(1.2, player.pos.z * 0.45));
    // portrait: aim further back so the room sits in the middle of the screen below the HUD, not in its top half
    camT.set(tx, 0.7, tz - (portrait ? 1.6 : 0.4)); camP.set(tx * 0.9, hgt, tz + dist);
  };
  goalCam(); camera.position.copy(camP); camera.lookAt(camT);
  const look = camT.clone();

  // arrival: the camera starts at the window and sweeps to the player
  const first = params.arrival || !game.save.flag("intro.done");
  let intro = first ? { k: 0 } : null;
  if (first) { camera.position.set(0.2, 1.7, -1.6); look.set(0, 1.6, -30); }

  let saveT = 0, lastSaved = "";
  const savePos = () => { const p = { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), r: +player.heading.toFixed(2) }; const k = JSON.stringify(p); if (k !== lastSaved) { lastSaved = k; game.save.set({ pos: p, scene: "room" }); } };

  game.room = { use: (id) => { const th = things.find((x) => x.id === id); if (th) return use(th); }, player }; // used by the game's own tests
  const onStationClose = () => { refreshBal(); game.host.api("GET", "/api/mjt/mining").then((m) => { mining = m; }).catch(() => { }); };
  game.bus.on("station-closed", onStationClose);

  return {
    scene, camera, bloom: { strength: 0.75, radius: 0.5, threshold: 0.82 },
    async enter() {
      frame(); game.audio.music("room"); game.audio.ambient("room");
      if (first) {
        busy = true; game.input.setEnabled(false);
        card(tl(C.title), tl(C.name));
        setTimeout(async () => {
          intro.k = 0.0001; await new Promise((r) => setTimeout(r, 2600));
          await player.gesture("Cheer");
          await game.ui.dialog(lines(C.intro), tl(C.narrator));
          game.save.set({ flags: { "intro.done": true } });
          $("#gm-obj").hidden = false; requestAnimationFrame(() => $("#gm-obj").classList.add("on"));
          busy = false; game.input.setEnabled(true); intro = null;
        }, 1400);
      } else { $("#gm-obj").hidden = done("done"); if (!done("done")) $("#gm-obj").classList.add("on"); }
    },
    update(dt, time) {
      const mv = game.input.update();
      if (Math.abs(mv.x) + Math.abs(mv.y) > 0.1) hideHelp();
      player.update(dt, busy ? { x: 0, y: 0, run: false } : mv, 0, world);
      // the nearest usable thing within reach
      let best = null, bd = 1.25;
      for (const th of things) { const d = Math.hypot(th.at.x - player.pos.x, th.at.z - player.pos.z); if (d < bd) { bd = d; best = th; } th.m.position.y = th.mark.y + Math.sin(time * 2.2 + th.mark.x) * 0.06; th.m.rotation.y += dt * 1.6; th.h.material.opacity += (((th === best) ? 0.9 : 0) - th.h.material.opacity) * Math.min(1, dt * 8); const isDone = th.goal ? done(th.id) : true; th.m.scale.setScalar(isDone ? 0.7 : 1); }
      if (best !== near) { near = best; if (!busy) { showAct(near); if (near) game.audio.sfx("hover"); } }
      if (busy && !$("#gm-act").hidden) showAct(null);
      // camera
      goalCam();
      if (cine) { cine.k = Math.min(1, cine.k + dt * 1.2); const e = 1 - Math.pow(1 - cine.k, 3); camera.position.lerpVectors(cine.from, cine.to, e); look.lerp(cine.look, Math.min(1, dt * 3)); }
      else if (intro && intro.k > 0) { intro.k = Math.min(1, intro.k + dt * 0.45); const e = intro.k * intro.k * (3 - 2 * intro.k); camera.position.lerp(camP, Math.min(1, dt * (0.6 + e * 3))); look.lerp(camT, Math.min(1, dt * (0.6 + e * 3))); }
      else if (!intro) { camera.position.lerp(camP, Math.min(1, dt * 3)); look.lerp(camT, Math.min(1, dt * 4)); }
      camera.lookAt(look);
      // the living room: monitor, news board, rain, city, door light
      if (Math.floor(time * 4) !== Math.floor((time - dt) * 4)) scr.tick(time);
      if (Math.floor(time * 6) !== Math.floor((time - dt) * 6)) news.tick(time);
      glass.material.uniforms.uTime.value = time;
      monGlow.intensity = 3.6 + Math.sin(time * 9) * 0.25 + (Math.random() < 0.02 ? -1.5 : 0);
      saveT += dt; if (saveT > 8) { saveT = 0; savePos(); }
    },
    exit() { savePos(); game.save.flush(); },
    dispose() { game.room = null; game.renderer.onResize = null; game.bus.off("station-closed", onStationClose); game.input.clear(); scene.environment?.dispose(); }
  };
}
