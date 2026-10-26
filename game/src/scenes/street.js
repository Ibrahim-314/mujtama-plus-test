/* Chapter 1 — «الشارع», v2.97 on Babylon.js. The apartment door opens onto a boulevard at sunset: Kenney's city kits
 * (CC0) for the buildings, road, lamps, parked cars and trees, PBR lit by an HDR environment and a low golden sun with
 * real shadows, a glow layer for the lamps, shop signs and the MJT tower's gold, filmic tone mapping, fog into the
 * skyline, and people walking the pavements (the same rigged characters as the player). Walk to the MJT tower at the end
 * of the street and go in: its own screen (os/tower.js) opens over the still street; closing it leaves you at its doors.
 * The game logic is the same as the three.js street (now scenes/street-classic.js, which still runs if Babylon can't
 * start on a device): the same coordinates, HUD, goals, tap-to-walk and the game.street test hooks.
 * Quality tiers (config.QUALITY via the renderer): low = no shadows/glow/post, fewer buildings and walkers. */
import { makeEngine, Models, textTexture, glowMat, Scene, Color3, Color4, Vector3, PBRMaterial, StandardMaterial, Texture } from "../bjs/core.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer.js";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture.js";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder.js";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { buildTower } from "../bjs/tower.js";
import { Hero, spawnCharacter } from "../bjs/hero.js";
import { charUrl } from "../world/player.js";
import { ASSET, CHARS, charById } from "../config.js";
import { t, tl, fill } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";
import { openPause } from "../ui/menus.js";
import { CHAPTER1 as C } from "../story/chapter1.js";
import { openTower } from "../os/tower.js";

const CORE_Z = -46;               // the tower's centre
const GATE_Z = CORE_Z + 8.2;      // the face of the tower's doors
const HOME_Z = 4.2;               // the face of the apartment block
const ROAD = 5, WALK = 9;         // half widths: the road, the road + pavements
const STILL = { x: 0, y: 0, run: false };
const K = (f) => ASSET("city/" + f + ".glb");
const rnd = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** Babylon needs WebGL; when it can't start here the classic three.js street runs instead */
function canBabylon() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export async function create(game, params = {}) {
  if (!canBabylon() || game.forceClassicStreet) return (await import("./street-classic.js")).create(game, params);
  try { return await createBabylon(game, params); } catch (e) {
    console.error("[street] babylon failed, classic street", e);
    document.querySelector(".gm-bjs")?.remove(); game.canvas.style.visibility = "";
    return (await import("./street-classic.js")).create(game, params);
  }
}

async function createBabylon(game, params) {
  const save = game.save.data || {}, name = save.name || "…";
  const q = game.renderer.q, tier = game.renderer.tier, low = tier === "low", high = tier === "high";
  const { canvas, engine } = makeEngine(game.surface, q);
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.08, 0.06, 0.14, 1);
  scene.skipPointerMovePicking = true; scene.skipPointerDownPicking = true; scene.skipPointerUpPicking = true;
  scene.detachControl?.();
  const models = new Models(scene);

  // ---------- light: a low golden sun from the right, a cool sky fill, the HDR environment for reflections ----------
  const env = CubeTexture.CreateFromPrefilteredData(ASSET("city/sky.env"), scene);
  scene.environmentTexture = env; scene.environmentIntensity = 0.42; // v2C: blue hour, the same evening as the room's window
  const hemi = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  hemi.diffuse = Color3.FromHexString("#8fa4ff"); hemi.groundColor = Color3.FromHexString("#3a2634"); hemi.intensity = 0.5;
  // the sun sits low over the far right of the street; the light, the sun's disc and the sky's glow share one direction
  const SUN_DIR = new Vector3(-0.74, -0.3, 0.6).normalize(); // a touch higher: shorter, crisper shadows
  const sun = new DirectionalLight("sun", SUN_DIR, scene);
  sun.position = SUN_DIR.scale(-80); sun.diffuse = Color3.FromHexString("#ffb27a"); sun.intensity = 2.0;
  let shadows = null;
  if (!low) {
    shadows = new ShadowGenerator(high ? 2048 : 1024, sun);
    shadows.usePercentageCloserFiltering = true; shadows.filteringQuality = high ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    shadows.bias = 0.0006; shadows.normalBias = 0.025; shadows.darkness = 0.42;
    // a tighter shadow frustum (the street, not the whole skyline): the same map covers less ground, so edges stay sharp
    sun.shadowMinZ = 1; sun.shadowMaxZ = 140; sun.autoUpdateExtends = true; sun.autoCalcShadowZBounds = true;
  }
  const cast = (node) => { if (!shadows || !node) return; for (const m of node.getChildMeshes ? node.getChildMeshes(false) : []) shadows.addShadowCaster(m, false); if (node.getTotalVertices) shadows.addShadowCaster(node, false); };
  // instances take shadows through their source mesh
  const recv1 = (m) => { (m.sourceMesh || m).receiveShadows = true; };
  const receive = (node) => { for (const m of node.getChildMeshes ? node.getChildMeshes(false) : []) recv1(m); if (node.getTotalVertices) recv1(node); };

  // ---------- sky: a sunset gradient on a dome, the sun's glow on the horizon, fog into the distance ----------
  const skyTex = textTexture(scene, 8, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#070b26"); g.addColorStop(0.26, "#18215a"); g.addColorStop(0.4, "#3c3f8a"); g.addColorStop(0.46, "#a8607e"); g.addColorStop(0.495, "#ffae66"); g.addColorStop(0.53, "#3a2c4e"); g.addColorStop(1, "#120e1e");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }, false);
  const skyM = new StandardMaterial("skyM", scene); skyM.emissiveTexture = skyTex; skyM.disableLighting = true; skyM.backFaceCulling = false; skyM.fogEnabled = false; skyM.diffuseColor = Color3.Black(); skyM.specularColor = Color3.Black();
  const sky = CreateSphere("sky", { diameter: 900, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene); sky.material = skyM; sky.infiniteDistance = true; sky.isPickable = false; sky.applyFog = false;
  const glowSun = CreateDisc("sunDisc", { radius: 26, tessellation: 48 }, scene);
  const sunTex = textTexture(scene, 256, 256, (x, w, h) => { const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, "rgba(255,240,200,1)"); g.addColorStop(0.18, "rgba(255,200,120,.9)"); g.addColorStop(0.5, "rgba(255,140,90,.25)"); g.addColorStop(1, "rgba(255,120,90,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  const sunM = new StandardMaterial("sunM", scene); sunM.emissiveTexture = sunTex; sunM.opacityTexture = sunTex; sunM.disableLighting = true; sunM.fogEnabled = false; sunM.alphaMode = Constants.ALPHA_ADD; sunM.disableDepthWrite = true;
  glowSun.material = sunM; glowSun.position.copyFrom(SUN_DIR.scale(-420)); glowSun.billboardMode = Mesh.BILLBOARDMODE_ALL; glowSun.isPickable = false; glowSun.infiniteDistance = true;
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = low ? 0.0085 : 0.0074; scene.fogColor = Color3.FromHexString("#40365e"); // atmospheric depth: far blocks fade into the dusk

  // ---------- ground: the road (Kenney tiles), pavements with kerbs, the plaza, the land around ----------
  const land = CreateGround("land", { width: 420, height: 420 }, scene);
  const landM = new PBRMaterial("landM", scene); landM.albedoColor = Color3.FromHexString("#3a3640"); landM.metallic = 0; landM.roughness = 0.95; land.material = landM; land.position.set(0, -0.02, -40); land.receiveShadows = true; land.isPickable = false;
  await Promise.all(["road/road-straight", "road/road-crossing"].map((k) => models.tint(K(k), "#8a8794", 0.82, 0)));
  for (let z = HOME_Z + 5; z > GATE_Z - 5; z -= 10) {
    const crossing = z - 5 < GATE_Z + 4;
    const r = await models.put(K(crossing ? "road/road-crossing" : "road/road-straight"), { x: 0, z: z - 5, s: 10, sy: 1 }); receive(r.root);
  }
  const paveTex = textTexture(scene, 256, 256, (x, w, h) => {
    x.fillStyle = "#b9b2a6"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "60,50,40"},${0.04 + Math.random() * 0.06})`; x.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    x.strokeStyle = "rgba(70,62,55,.55)"; x.lineWidth = 3; for (let i = 0; i <= w; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); }
  }, false);
  paveTex.wrapU = paveTex.wrapV = Texture.WRAP_ADDRESSMODE;
  const len = HOME_Z - GATE_Z + 14, midZ = (HOME_Z + GATE_Z) / 2 - 2;
  const paveM = new PBRMaterial("paveM", scene); paveM.albedoTexture = paveTex; paveM.metallic = 0; paveM.roughness = 0.85;
  paveTex.uScale = (WALK - ROAD) / 2; paveTex.vScale = len / 2;
  const gutterM = new PBRMaterial("gutterM", scene); gutterM.albedoColor = Color3.FromHexString("#2a2830"); gutterM.metallic = 0; gutterM.roughness = 0.5;
  const kerbM = new PBRMaterial("kerbM", scene); kerbM.albedoColor = Color3.FromHexString("#d9d4cc"); kerbM.metallic = 0; kerbM.roughness = 0.7;
  for (const s of [-1, 1]) {
    const pv = CreateBox("pave", { width: WALK - ROAD + 6, height: 0.16, depth: len }, scene); pv.material = paveM; pv.position.set(s * ((ROAD + WALK + 6) / 2), 0.08, midZ); pv.receiveShadows = true; pv.isPickable = false;
    const kb = CreateBox("kerb", { width: 0.25, height: 0.2, depth: len }, scene); kb.material = kerbM; kb.position.set(s * (ROAD + 0.12), 0.1, midZ); kb.receiveShadows = true; kb.isPickable = false;
    pv.freezeWorldMatrix(); kb.freezeWorldMatrix();
    // a dark gutter strip where the road meets the kerb
    const gt = CreateGround("gutter", { width: 0.45, height: len }, scene); gt.material = gutterM; gt.position.set(s * (ROAD - 0.22), 0.012, midZ); gt.isPickable = false; gt.receiveShadows = true; gt.freezeWorldMatrix();
  }
  // road markings: a dashed centre line, a zebra crossing before the tower plaza, a stop line
  const paintM = new PBRMaterial("paint", scene); paintM.albedoColor = Color3.FromHexString("#e9e4da"); paintM.metallic = 0; paintM.roughness = 0.6;
  const dash0 = CreateGround("dash", { width: 0.16, height: 2.4 }, scene); dash0.material = paintM; dash0.isPickable = false; dash0.receiveShadows = true; dash0.position.set(0, 0.014, HOME_Z - 3);
  for (let z = HOME_Z - 7.5; z > GATE_Z + 9; z -= 4.5) { const d = dash0.createInstance("dash"); d.position.set(0, 0.014, z); }
  const zebra0 = CreateGround("zebra", { width: 0.6, height: 3.4 }, scene); zebra0.material = paintM; zebra0.isPickable = false; zebra0.receiveShadows = true; zebra0.position.set(-ROAD + 0.7, 0.015, GATE_Z + 5.4);
  for (let x = -ROAD + 1.9; x < ROAD - 0.4; x += 1.2) { const zb = zebra0.createInstance("zebra"); zb.position.set(x, 0.015, GATE_Z + 5.4); }
  const stop = CreateGround("stopLine", { width: ROAD * 2 - 0.6, height: 0.3 }, scene); stop.material = paintM; stop.position.set(0, 0.015, GATE_Z + 7.6); stop.isPickable = false; stop.receiveShadows = true;

  // ---------- the tower ----------
  const tower = buildTower(scene, { z: CORE_Z, gateZ: GATE_Z, low });
  if (shadows) for (const m of tower.casters) shadows.addShadowCaster(m, false);
  const towerColliders = tower.colliders;

  // ---------- both sides of the street: Kenney buildings facing the road, a sign over every shop ----------
  const R = rnd(31), colliders = [...towerColliders];
  const FRONT = ["a", "b", "c", "d", "e", "f", "g", "h", "k", "l", "m", "n"];
  const SIGNS = [["مقهى الحي", "#ffb04a"], ["صيدلية", "#3dffb0"], ["مخبز", "#ffd27a"], ["بقالة", "#7fd6ff"], ["إلكترونيات", "#2fe6ff"], ["عطور", "#ff7ad9"], ["مطعم", "#ff8a5c"], ["مكتبة", "#b58cff"]];
  const BW = { a: 8.8, b: 9.2, c: 10, d: 8, e: 16.4, f: 9, g: 9, h: 8.6, k: 20.8, l: 18, m: 9, n: 9.6 }; // footprint along the street (m), measured
  const buildingDepth = 9.6;
  let signN = 0;
  const signMats = SIGNS.map(([txt, col]) => {
    const tx = textTexture(scene, 512, 128, (x, w, h) => {
      x.fillStyle = "rgba(10,10,20,.82)"; x.fillRect(0, 0, w, h); x.strokeStyle = col; x.lineWidth = 6; x.strokeRect(5, 5, w - 10, h - 10);
      x.direction = "rtl"; x.textAlign = "center"; x.textBaseline = "middle"; x.shadowColor = col; x.shadowBlur = 16; x.fillStyle = col; x.font = "bold 64px sans-serif"; x.fillText(txt, w / 2, h / 2 + 4);
    }, false, true);
    const m = new StandardMaterial("shop", scene); m.emissiveTexture = tx; m.disableLighting = true; m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); return m;
  });
  // striped canvas awnings in each shop's colour, over its sign
  const awnMats = SIGNS.map(([, col], i) => {
    const tx = textTexture(scene, 128, 64, (x, w, h) => { for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? "#f3eee4" : col; x.fillRect(k * w / 8, 0, w / 8, h); } x.fillStyle = "rgba(0,0,0,.25)"; x.fillRect(0, h - 8, w, 8); }, false);
    const m = new PBRMaterial("awning" + i, scene); m.albedoTexture = tx; m.metallic = 0; m.roughness = 0.85; m.backFaceCulling = false; return m;
  });
  // every building type its own facade tone (each model file has its own materials, so a tint covers all its copies)
  const TONES = { a: "#efdcc2", b: "#c98f78", c: "#9fb0c8", d: "#e6c38e", e: "#b9a08c", f: "#a9bdb2", g: "#f0e6d8", h: "#b88a8c", k: "#e2d2b8", l: "#8f98b8", m: "#d9a77e", n: "#c7cbbd" };
  await Promise.all(Object.entries(TONES).map(([k, hex]) => models.tint(K("com/building-" + k), hex, 0.66)));
  for (const side of [-1, 1]) {
    let z = HOME_Z - 1.5; const end = GATE_Z + 6;
    const pool = FRONT.slice().sort(() => R() - 0.5);
    let i = 0;
    while (z > end) {
      const k = pool[i++ % pool.length], w = BW[k];
      if (z - w < end - 4) break;
      const zc = z - w / 2, x = side * (WALK + buildingDepth / 2 + 0.3);
      // heights vary a little (a storey more or less) so the street line isn't a row of the same boxes
      const bs = 10 + R() * 0.6, b = await models.put(K("com/building-" + k), { x, z: zc, ry: side < 0 ? Math.PI / 2 : -Math.PI / 2, s: bs, sy: bs * (0.94 + R() * 0.2) });
      cast(b.root); receive(b.root);
      colliders.push({ min: { x: Math.min(side * WALK, side * (WALK + buildingDepth)), z: zc - w / 2 }, max: { x: Math.max(side * WALK, side * (WALK + buildingDepth)), z: zc + w / 2 } });
      // a lit shop sign over the ground floor
      if (signN < SIGNS.length * 2 && R() < 0.85) {
        const sg = CreatePlane("shopSign", { width: 3.2, height: 0.8 }, scene); sg.material = signMats[signN++ % signMats.length];
        const sz = zc + (R() - 0.5) * (w - 4), si = (signN - 1) % SIGNS.length;
        sg.position.set(side * (WALK + 0.12), 3.35, sz); sg.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; sg.isPickable = false; sg.freezeWorldMatrix();
        if (!low) {
          const aw = CreatePlane("awning", { width: 3.6, height: 1.3 }, scene); aw.material = awnMats[si]; aw.isPickable = false;
          aw.position.set(side * (WALK - 0.45), 2.75, sz); aw.rotation.set(0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0); aw.rotation.x = 0; aw.addRotation(side < 0 ? -0.75 : -0.75, 0, 0); cast(aw); aw.receiveShadows = true;
        }
      }
      z -= w + 0.6;
    }
  }
  // the second row and the skyline: Kenney skyscrapers behind the street and around the tower, low-detail blocks far out
  const TALL = ["building-skyscraper-a", "building-skyscraper-b", "building-skyscraper-c", "building-skyscraper-e"];
  const FAR = ["low-detail-building-a", "low-detail-building-c", "low-detail-building-e", "low-detail-building-g", "low-detail-building-wide-a"];
  const tallSpots = [];
  for (let z = 6; z > -96; z -= 15) for (const s of [-1, 1]) tallSpots.push([s * (34 + R() * 10), z + R() * 6]);
  for (const s of [-1, 1]) for (const z of [-62, -80]) tallSpots.push([s * (16 + R() * 6), z]);
  for (const [x, z] of tallSpots.slice(0, low ? 10 : tallSpots.length)) {
    const b = await models.put(K("com/" + TALL[(R() * TALL.length) | 0]), { x, z, ry: Math.round(R() * 4) * Math.PI / 2, s: 10 + R() * 4 }); receive(b.root); if (high) cast(b.root);
  }
  if (!low) for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2, r = 95 + R() * 70, x = Math.cos(a) * r, z = -40 + Math.sin(a) * r;
    await models.put(K("com/" + FAR[(R() * FAR.length) | 0]), { x, z, ry: R() * 6.3, s: 14 + R() * 10 });
  }

  // ---------- the apartment block the player came out of, with its lit doorway ----------
  const home = await models.put(K("com/building-k"), { x: 0, z: HOME_Z + 4.9, ry: Math.PI, s: 11 }); receive(home.root); cast(home.root);
  const homeGlow = CreatePlane("homeDoor", { width: 1.7, height: 2.5 }, scene); homeGlow.material = glowMat(scene, "#ffd9a0", 1.3, "homeDoor"); homeGlow.position.set(0, 1.25 + 0.16, HOME_Z - 0.02); homeGlow.isPickable = false;
  const frameM = glowMat(scene, "#ffc23d", 1.4, "homeFrame");
  for (const [w, h, x, y] of [[0.12, 2.7, -0.92, 1.35], [0.12, 2.7, 0.92, 1.35], [1.96, 0.12, 0, 2.7]]) { const f = CreateBox("hf", { width: w, height: h, depth: 0.1 }, scene); f.material = frameM; f.position.set(x, y + 0.16, HOME_Z - 0.05); f.isPickable = false; }

  // ---------- street furniture: lamps with light pools, trees in planters, parked cars, a few details ----------
  const lampZ = []; for (let z = HOME_Z - 5; z > GATE_Z + 3; z -= 10) lampZ.push(z);
  const headM = glowMat(scene, "#ffe2b0", 2.2, "lampHead");
  const poolTex = textTexture(scene, 128, 128, (x, w, h) => { const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, "rgba(255,206,150,.34)"); g.addColorStop(0.5, "rgba(255,186,120,.1)"); g.addColorStop(1, "rgba(255,190,130,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  const poolM = new StandardMaterial("pool", scene); poolM.emissiveTexture = poolTex; poolM.opacityTexture = poolTex; poolM.disableLighting = true; poolM.alphaMode = Constants.ALPHA_ADD; poolM.disableDepthWrite = true;
  const pool0 = CreateGround("pool", { width: 4.2, height: 5.4 }, scene); pool0.material = poolM; pool0.isPickable = false; pool0.position.y = -1000;
  const bulb0 = CreateBox("bulb", { width: 0.5, height: 0.08, depth: 0.9 }, scene); bulb0.material = headM; bulb0.isPickable = false; bulb0.position.y = -1000;
  for (const z of lampZ) for (const s of [-1, 1]) {
    const x = s * (ROAD + 0.75);
    const l = await models.put(K("road/light-curved"), { x, z, ry: s < 0 ? -Math.PI / 2 : Math.PI / 2, s: 10 }); cast(l.root);
    const bl = bulb0.createInstance("b"); bl.position.set(x - s * 1.85, 6.42, z); bl.rotation.y = Math.PI / 2;
    const p = pool0.createInstance("p"); p.position.set(x - s * 1.3, 0.03 + (s < 0 ? 0 : 0.001), z);
    colliders.push({ min: { x: x - 0.25, z: z - 0.25 }, max: { x: x + 0.25, z: z + 0.25 } });
  }
  // trees in planters between the lamps, on both pavements
  for (const z of lampZ) for (const s of [-1, 1]) {
    const tz = z - 5, x = s * (WALK - 1.6); if (tz < GATE_Z + 6) continue;
    const pl = await models.put(K("sub/planter"), { x, z: tz, ry: Math.PI / 2, s: 6 }); receive(pl.root);
    const tr = await models.put(K("sub/" + (R() < 0.6 ? "tree-large" : "tree-small")), { x, z: tz, y: 0.95, ry: R() * 6.3, s: 9 + R() * 2 }); cast(tr.root);
    colliders.push({ min: { x: x - 1.2, z: tz - 0.9 }, max: { x: x + 1.2, z: tz + 0.9 } });
  }
  // parked cars along both kerbs (the middle of the road stays free to walk)
  const CARS = ["sedan", "taxi", "suv-luxury", "hatchback-sports", "van", "sedan"];
  const CAR_DIM = { sedan: [1.27, -1.27, 0.32], taxi: [1.37, -1.37, 0.32], "suv-luxury": [1.43, -1.43, 0.38], "hatchback-sports": [1.43, -1.43, 0.3], van: [1.25, -1.5, 0.36] };
  // car paint: a little gloss and metal, not chrome (the kits share one palette per model, so tyres take it too, kept modest)
  await Promise.all([...new Set(CARS)].map((k) => models.tint(K("car/" + k), "#ffffff", 0.42, 0.25)));
  const headL0 = CreateBox("headL", { width: 0.28, height: 0.1, depth: 0.02 }, scene); headL0.material = glowMat(scene, "#fff1d0", 1.6, "headL"); headL0.isPickable = false; headL0.position.y = -1000;
  const tailL0 = CreateBox("tailL", { width: 0.26, height: 0.09, depth: 0.02 }, scene); tailL0.material = glowMat(scene, "#ff2a2a", 1.3, "tailL"); tailL0.isPickable = false; tailL0.position.y = -1000;
  // parked clear of the doors at both ends and of the crossing; the middle of the road stays free to walk
  const carSpots = [[1, -9.5], [-1, -14], [1, -19.5], [-1, -22.5]];
  for (const [s, z] of carSpots.slice(0, low ? 3 : carSpots.length)) {
    // Kenney's cars are toy-stubby: scaled to real proportions (about 1.9 m wide, 1.6 m tall, 4.1-4.6 m long), wheels on the road
    const kind = CARS[(R() * CARS.length) | 0], x = s * (ROAD - 1.25), CY = 1.1;
    const car = await models.put(K("car/" + kind), { x, z, y: 0.3 * CY, ry: s < 0 ? 0 : Math.PI, sx: 1.25, sy: CY, sz: 1.62 });
    cast(car.root); colliders.push({ min: { x: x - 1.05, z: z - 2.35 }, max: { x: x + 1.05, z: z + 2.35 } });
    // head and tail lamps (in the model's own units, so they follow its scale): warm white at the front, red at the back
    const [fz, bz, hy] = CAR_DIM[kind];
    for (const sx of [-1, 1]) {
      const hl = headL0.createInstance("headL"); hl.parent = car.root; hl.position.set(sx * 0.48, hy, fz + 0.01);
      const tl = tailL0.createInstance("tailL"); tl.parent = car.root; tl.position.set(sx * 0.5, hy + 0.05, bz - 0.01);
    }
  }
  if (!low) { await models.put(K("road/traffic-light"), { x: ROAD + 0.6, z: GATE_Z + 6.5, ry: Math.PI / 2, s: 9 }); await models.put(K("road/traffic-light"), { x: -ROAD - 0.6, z: GATE_Z + 6.5, ry: -Math.PI / 2, s: 9 }); }
  // benches facing the road, litter bins by the lamps, bollards where the pavement meets the plaza
  const woodM = new PBRMaterial("wood", scene); woodM.albedoColor = Color3.FromHexString("#8a5a36"); woodM.metallic = 0; woodM.roughness = 0.7;
  const ironM = new PBRMaterial("iron", scene); ironM.albedoColor = Color3.FromHexString("#23252c"); ironM.metallic = 0.8; ironM.roughness = 0.45;
  const binM = new PBRMaterial("bin", scene); binM.albedoColor = Color3.FromHexString("#2f4a3c"); binM.metallic = 0.5; binM.roughness = 0.5;
  const bench = new TransformNode("benchT", scene);
  for (const [w, h, d, x, y, zz, m] of [[1.9, 0.07, 0.5, 0, 0.46, 0, woodM], [1.9, 0.38, 0.06, 0, 0.72, 0.24, woodM], [0.07, 0.46, 0.5, -0.82, 0.23, 0, ironM], [0.07, 0.46, 0.5, 0.82, 0.23, 0, ironM]]) {
    const b = CreateBox("benchPart", { width: w, height: h, depth: d }, scene); b.material = m; b.parent = bench; b.position.set(x, y, zz); b.isPickable = false; b.receiveShadows = true;
  }
  bench.position.y = -1000;
  const bin0 = CreateCylinder("bin", { diameterTop: 0.5, diameterBottom: 0.42, height: 0.9, tessellation: 16 }, scene); bin0.material = binM; bin0.isPickable = false; bin0.position.y = -1000;
  const boll0 = CreateCylinder("bollard", { diameter: 0.22, height: 0.85, tessellation: 12 }, scene); boll0.material = ironM; boll0.isPickable = false; boll0.position.y = -1000;
  const placed = [];
  for (const z of lampZ) for (const s of [-1, 1]) {
    const bz = z - 2.4, bx = s * (WALK - 1.0); if (bz < GATE_Z + 7) continue;
    if (!low) { const b = bench.instantiateHierarchy(null, undefined, (src, dst) => { dst.isPickable = false; }); b.setEnabled(true); b.position.set(bx, 0.16, bz); b.rotation.y = s < 0 ? -Math.PI / 2 : Math.PI / 2; placed.push(b); colliders.push({ min: { x: bx - 0.45, z: bz - 1 }, max: { x: bx + 0.45, z: bz + 1 } }); }
    const bn = bin0.createInstance("bin"); bn.setEnabled(true); bn.position.set(s * (ROAD + 1.4), 0.61, z + 1.2); placed.push(bn); colliders.push({ min: { x: s * (ROAD + 1.4) - 0.3, z: z + 0.9 }, max: { x: s * (ROAD + 1.4) + 0.3, z: z + 1.5 } });
  }
  for (const s of [-1, 1]) for (let z = GATE_Z + 1.5; z < GATE_Z + 9; z += 1.6) { const b = boll0.createInstance("bollard"); b.setEnabled(true); b.position.set(s * (ROAD + 0.45), 0.58, z); placed.push(b); }
  if (shadows) for (const p of placed) cast(p);
  if (!low) { const p = await models.put(K("com/detail-parasol-a"), { x: -(WALK - 2.2), z: -11, s: 8 }); cast(p.root); const p2 = await models.put(K("com/detail-parasol-a"), { x: WALK - 2.2, z: -14, s: 8 }); cast(p2.root); colliders.push({ min: { x: -WALK + 1.4, z: -11.8 }, max: { x: -WALK + 3, z: -10.2 } }, { min: { x: WALK - 3, z: -14.8 }, max: { x: WALK - 1.4, z: -13.2 } }); }

  // ---------- the two places you can use: a turning marker over each, a halo on the ground when you're close ----------
  const things = [
    { id: "tower", at: new Vector3(0, 0, GATE_Z + 1.4), mark: new Vector3(0, 8.6, GATE_Z + 0.4), face: new Vector3(0, 0, GATE_Z - 3), hitAt: new Vector3(0, 2.6, GATE_Z + 0.4), hitS: [5.2, 5.6, 2] },
    // Season 1: the dead public terminal on the left pavement where Yousuf's signal surfaces (live only between Salma and Sada)
    { id: "signal", at: new Vector3(-(ROAD + 1.5), 0, midZ + 1.2), mark: new Vector3(-(ROAD + 2.4), 3.1, midZ), face: new Vector3(-(ROAD + 2.4), 0, midZ), hitAt: new Vector3(-(ROAD + 2.4), 1.2, midZ), hitS: [1.4, 2.4, 1.2] },
    { id: "home", at: new Vector3(0, 0, HOME_Z - 1.1), mark: new Vector3(0, 3.4, HOME_Z - 0.2), face: new Vector3(0, 0, HOME_Z + 3), hitAt: new Vector3(0, 1.3, HOME_Z - 0.2), hitS: [2.2, 2.6, 0.8] }
  ];
  for (const th of things) {
    const col = th.id === "tower" ? "#ffc23d" : "#2fe6ff";
    th.m = CreatePolyhedron("mark", { type: 1, size: th.id === "tower" ? 0.36 : th.id === "signal" ? 0.22 : 0.16 }, scene); th.m.material = glowMat(scene, col, 1.8, "mark"); th.m.position.copyFrom(th.mark); th.m.isPickable = false;
    th.h = CreateDisc("halo", { radius: 0.6, tessellation: 40 }, scene); const hm = glowMat(scene, col, 1.4, "halo"); hm.alpha = 0; hm.alphaMode = Constants.ALPHA_ADD; hm.disableDepthWrite = true; th.h.material = hm; th.h.rotation.x = Math.PI / 2; th.h.position.set(th.at.x, 0.2, th.at.z); th.h.isPickable = false;
    th.hit = CreateBox("hit", { width: th.hitS[0], height: th.hitS[1], depth: th.hitS[2] }, scene); th.hit.position.copyFrom(th.hitAt); th.hit.isVisible = false; th.hit.metadata = { thing: th };
  }
  // the terminal itself: a slim dark pillar with a dead screen that flickers while the signal is live (procedural, no new asset)
  const sig = things.find((x) => x.id === "signal");
  const sigLive = () => !!game.save.flag("story.salma") && !game.save.flag("story.sada");
  {
    const body = CreateBox("sigBody", { width: 0.5, height: 2.2, depth: 0.9 }, scene); body.position.set(sig.hitAt.x, 1.1 + 0.16, sig.hitAt.z);
    const bm = new PBRMaterial("sigBodyM", scene); bm.albedoColor = new Color3(0.06, 0.07, 0.09); bm.metallic = 0.7; bm.roughness = 0.45; body.material = bm;
    sig.screen = CreateBox("sigScreen", { width: 0.7, height: 1.0, depth: 0.04 }, scene); sig.screen.position.set(sig.hitAt.x + 0.27, 1.5 + 0.16, sig.hitAt.z); sig.screen.rotation.y = Math.PI / 2; // facing the road
    sig.screenM = glowMat(scene, "#2fe6ff", 0.05, "sigScreen"); sig.screen.material = sig.screenM; sig.screen.isPickable = false; body.isPickable = false;
    sig.body = body; if (shadows) shadows.addShadowCaster(body, false);
    colliders.push({ min: { x: sig.hitAt.x - 0.35, z: sig.hitAt.z - 0.55 }, max: { x: sig.hitAt.x + 0.35, z: sig.hitAt.z + 0.55 } });
  }
  const tapFloor = CreateGround("tapFloor", { width: 60, height: 120 }, scene); tapFloor.position.set(0, 0, midZ); tapFloor.isVisible = false; tapFloor.metadata = { floor: true };
  const pickable = (m) => m === tapFloor || !!m.metadata?.thing;

  // ---------- the player, and people on the pavements ----------
  const ch = spawnCharacter(await models.get(charUrl(save.char || "hoodie")), 1.72, "hero");
  const player = new Hero(scene, ch, game.audio); if (shadows) for (const m of ch.meshes) shadows.addShadowCaster(m, false);
  const back = params.from === "tower";
  // Phase 2D-A: «Continue» resumes in the street at the saved spot (clamped to the boulevard); the door / tower keep their spots
  const sp = !back && !params.from && save.scene === "street" && save.pos ? save.pos : null;
  const clampS = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  if (sp) { player.pos.set(clampS(sp.x, -WALK + 0.6, WALK - 0.6), 0, clampS(sp.z, GATE_Z + 1.2, HOME_Z - 1.0)); player.heading = Number(sp.r) || Math.PI; }
  else { player.pos.set(0, 0, back ? GATE_Z + 2.2 : HOME_Z - 1.4); player.heading = back ? 0 : Math.PI; }
  let leaving = false, spotT = 0, lastSpot = "";
  const saveSpot = () => { const p = { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), r: +player.heading.toFixed(2) }; const k = JSON.stringify(p); if (k !== lastSpot) { lastSpot = k; game.save.set({ scene: "street", pos: p }); } };
  // the guide ring and marker sit on the road, a hair above it
  const world = { colliders, bounds: { minX: -WALK + 0.2, maxX: WALK - 0.2, minZ: GATE_Z + 0.55, maxZ: HOME_Z - 0.45 } };
  const walkers = [];
  const others = CHARS.map((c) => c.id).filter((id) => id !== (save.char || "hoodie"));
  const nWalk = low ? 2 : high ? 5 : 3;
  for (let i = 0; i < nWalk; i++) {
    try {
      const id = others[i % others.length];
      const nc = spawnCharacter(await models.get(charUrl(id)), 1.62 + R() * 0.18, "npc" + i);
      const h = new Hero(scene, nc, null, { npc: true }); h.pace = 0.95 + R() * 0.4;
      const s = i % 2 ? 1 : -1, lane = s * (WALK - 3.4 + R() * 0.8);
      h.pos.set(lane, 0.16, HOME_Z - 3 - R() * 30); h.dir = R() < 0.5 ? -1 : 1; h.lane = lane; h.heading = h.dir < 0 ? Math.PI : 0; h.pause = 0;
      if (shadows) for (const m of nc.meshes) shadows.addShadowCaster(m, false);
      walkers.push(h);
    } catch (e) { console.warn("[street] walker", e); }
  }

  // Salma, the receptionist, waiting by the tower's door (one of the existing characters; skipped if it fails to load)
  let salma = null;
  try {
    const sc = spawnCharacter(await models.get(charUrl((save.char || "hoodie") === "suit-f" ? "casual-f" : "suit-f")), 1.66, "npcSalma");
    salma = new Hero(scene, sc, null, { npc: true }); salma.pos.set(1.9, 0.14, GATE_Z + 1.1); salma.heading = 0;
    if (shadows) for (const m of sc.meshes) shadows.addShadowCaster(m, false);
  } catch (e) { console.warn("[street] salma", e); }

  // ---------- post: glow on emissive things, filmic tone mapping, FXAA, a little bloom and vignette ----------
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES; ip.exposure = 1.12; ip.contrast = 1.14;
  ip.vignetteEnabled = !low; ip.vignetteWeight = 1.6; ip.vignetteColor = new Color4(0.08, 0.02, 0.12, 0);
  let glow = null, pipe = null;
  const camera = new FreeCamera("cam", new Vector3(0, 1.7, HOME_Z - 0.4), scene); camera.minZ = 0.1; camera.maxZ = 1200; camera.inputs.clear();
  if (!low) {
    glow = new GlowLayer("glow", scene, { mainTextureRatio: high ? 0.5 : 0.35, blurKernelSize: high ? 32 : 24 }); glow.intensity = 0.5;
    glow.addExcludedMesh(sky); glow.addExcludedMesh(glowSun);
    pipe = new DefaultRenderingPipeline("post", true, scene, [camera]);
    pipe.fxaaEnabled = true; pipe.samples = high ? 4 : 1;
    pipe.bloomEnabled = high; pipe.bloomThreshold = 0.92; pipe.bloomWeight = 0.15; pipe.bloomKernel = 48; pipe.bloomScale = 0.5;
    pipe.imageProcessingEnabled = true;
    // contact shadows where walls meet pavements, under cars and benches: the strongest tier only (it costs a depth pass)
    if (high && engine.webGLVersion >= 2) {
      try { const ao = new SSAO2RenderingPipeline("ao", scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera], false); ao.radius = 1.6; ao.totalStrength = 0.9; ao.samples = 12; ao.maxZ = 90; ao.expensiveBlur = false; } catch (e) { console.warn("[street] ssao", e); }
    }
  }
  // static meshes: freeze their transforms
  for (const m of scene.meshes) if (!m.skeleton && !m.metadata?.thing && m !== tapFloor && !/^(hero|npc)/.test(m.name) && !/mark|halo|ring|coin|door/.test(m.name)) m.freezeWorldMatrix?.();

  // ---------- HUD (the room's styles) ----------
  const c0 = charById(save.char);
  const L = game.ui.layer(`
    <header class="gm-hud-top">
      <div class="gm-plate"><img src="${ASSET(`chars/${c0.id}.webp`)}" alt="" width="44" height="44" decoding="async"><div><b>${esc(name)}</b><span>${esc(t("المستوى", "Level"))} ${save.level || 1}</span><i class="gm-xp"><i></i></i></div></div>
      <div class="gm-hud-end">
        <a class="gm-coin" href="#/city/mjt/balance" aria-label="${esc(t("رصيدك من مجتمع كوين", "Your Mujtama Coin balance"))}">${icon("coin")}<bdi id="gm-bal">…</bdi><small>MJT</small></a>
        <button type="button" class="gm-ico" id="gm-menu" aria-label="${esc(t("القائمة", "Menu"))}">${icon("menu")}</button>
      </div>
    </header>
    <section class="gm-obj" id="gm-obj"><span class="gm-obj-k">${esc(tl(C.title))} · ${esc(tl(C.name))}</span><b id="gm-obj-t">${esc(tl(C.objective))}</b>
      <ul><li data-g="tower">${icon("check")}<span>${esc(tl(C.things.tower.label))}</span></li><li data-g="salma" hidden>${icon("check")}<span>${esc(tl(C.next.goal))}</span></li><li data-g="sada" hidden>${icon("check")}<span>${esc(tl(C.after.goal))}</span></li></ul></section>
    <p class="gm-help" id="gm-help">${esc(game.input.touch ? t("المس الطريق لتمشي · المس البرج لتدخله", "Tap the road to walk · tap the tower to go in") : t("WASD أو الأسهم للتحرك · انقر للمشي · E للدخول", "WASD / arrows or click to walk · E to enter"))}</p>
    <button type="button" class="gm-act" id="gm-act" hidden data-sfx="click"><span class="gm-act-i">${icon("hand")}</span><span class="gm-act-t"><small id="gm-act-k"></small><b id="gm-act-v"></b></span></button>
    <div class="gm-card" id="gm-card" hidden><small></small><b></b></div>`, "gm-room gm-street");
  const $ = (s) => L.querySelector(s);
  const paintObj = () => {
    $("[data-g=tower]").classList.toggle("ok", !!game.save.flag("street.tower"));
    // Season 1: once Salma has spoken, the objective moves on to the fortieth floor
    const met = !!game.save.flag("story.salma"), li = $("[data-g=salma]");
    const heard = met && !!game.save.flag("story.sada"), l2 = $("[data-g=sada]");
    li.hidden = !met; li.classList.toggle("ok", heard); l2.hidden = !heard;
    $("#gm-obj-t").textContent = tl(heard ? C.after.objective : met ? C.next.objective : C.objective);
  };
  const refreshBal = () => { if (!game.member) { $("#gm-bal").textContent = "—"; return; } game.host.api("GET", "/api/mjt/me").then((m) => { $("#gm-bal").textContent = String(m.balance.mjt); }, () => { $("#gm-bal").textContent = "—"; }); };
  refreshBal(); paintObj(); game.missions?.paint();
  $("#gm-menu").addEventListener("click", () => openPause(game));
  game.input.on("pause", () => { if (game.scenes.name === "street" && !game.ui.modalOpen && !busy) openPause(game); });
  function card(k, v) { const c = $("#gm-card"); c.querySelector("small").textContent = k; c.querySelector("b").textContent = v; c.hidden = false; c.classList.remove("on"); void c.offsetWidth; c.classList.add("on"); setTimeout(() => { c.hidden = true; }, 3200); }

  // ---------- interaction ----------
  let near = null, busy = false, inHall = false, helpGone = false, push = null, doorGlow = 0;
  const showAct = (th) => { const a = $("#gm-act"); if (!th) { a.hidden = true; return; } $("#gm-act-k").textContent = tl(C.things[th.id].label); $("#gm-act-v").textContent = tl(C.things[th.id].verb); a.hidden = false; a.dataset.goal = th.id === "tower" ? "1" : ""; };
  const hideHelp = () => { if (helpGone) return; helpGone = true; $("#gm-help").classList.add("gone"); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const flash = (on) => game.root.classList.toggle("gm-flash-on", on);

  async function use(th) {
    if (busy) return; busy = true; showAct(null); player.walkTo(null); player.face(th.face.x, th.face.z);
    try {
      if (th.id === "tower") {
        if (!game.save.flag("story.salma")) await meetSalma();
        game.audio.sfx("open"); doorGlow = 1;
        player.walkTo({ x: 0, z: GATE_Z + 0.6 });
        push = { from: camera.position.clone(), to: new Vector3(0, 2.6, GATE_Z + 3.4), lf: look.clone(), look: new Vector3(0, 2.4, GATE_Z - 6), k: 0 };
        await wait(900); game.audio.sfx("whoosh"); flash(true); await wait(380);
        if (!game.save.flag("street.tower")) { game.save.set({ flags: { "street.tower": true } }); game.audio.sfx("ping"); paintObj(); }
        game.missions?.complete("c1.tower"); // Phase 2D-A: XP from the server only (story-flow check; a repeat grants nothing)
        game.save.flush();
        inHall = true; game.loop.pause(true);
        game.street.tower = openTower(game, { onClose: () => { game.street.tower = null; game.loop.pause(false); onStationClose(); } });
        await wait(250); flash(false);
        return;
      }
      if (th.id === "signal") { if (sigLive()) await meetSada(); return; }
      if (th.id === "home") {
        game.audio.sfx("open"); game.scenes.reg.room?.().catch(() => { }); player.walkTo({ x: 0, z: HOME_Z - 0.5 });
        push = { from: camera.position.clone(), to: new Vector3(0, 2.0, HOME_Z - 3.6), lf: look.clone(), look: new Vector3(0, 1.3, HOME_Z + 4), k: 0 };
        await wait(700); game.audio.sfx("whoosh"); flash(true); await wait(320);
        leaving = true; game.save.set({ scene: "room", pos: null }); // the room places you at its door and saves its own spot
        await game.scenes.go("room", { from: "door", fade: 250, fadeIn: 600 }); flash(false);
        return;
      }
    } finally { if (!inHall) busy = false; }
  }
  // ---------- Season 1, «الإشارة»: Salma at the front desk, the key «40», what she knows of Yousuf ----------
  // Played once, the first time the player goes in; then the objective becomes the fortieth floor. The tower's inside is
  // still the MJT OS screen (os/tower.js): this beat happens at its door, in the street, before that screen opens.
  async function meetSalma() {
    if (salma) { const f = Math.atan2(player.pos.x - salma.pos.x, player.pos.z - salma.pos.z); salma.heading = f; }
    player.face(salma ? salma.pos.x : 0, salma ? salma.pos.z : GATE_Z);
    const names = { salma: tl(C.salmaName), narrator: tl(C.narrator) };
    for (const beat of C.salma) await game.ui.dialog(beat.lines.map((l) => fill(tl(l), { name })), names[beat.who] || "");
    game.save.set({ flags: { "story.salma": true } }); game.audio.sfx("ping"); paintObj();
    card(tl(C.next.card), tl(C.next.objective)); game.save.flush();
    toastHint();
  }
  const toastHint = () => game.ui.toast(esc(tl(C.next.hint)));
  // ---------- Season 1, «الإشارة الأولى»: the key wakes the dead terminal, Yousuf's recording, first contact with Sada ----------
  async function meetSada() {
    player.face(sig.hitAt.x, sig.hitAt.z); game.audio.sfx("reveal");
    const names = { narrator: tl(C.narrator), yousuf: tl(C.yousufName), sada: tl(C.sadaName) };
    for (const beat of C.signal) await game.ui.dialog(beat.lines.map((l) => fill(tl(l), { name })), names[beat.who] || "");
    // story progress lives in the save (presentation); the XP is the server's alone (fixed in its catalogue, once per member)
    game.save.set({ flags: { "story.sada": true } }); game.audio.sfx("ping"); paintObj();
    game.missions?.complete("c1.signal");
    card(tl(C.after.card), tl(C.after.objective)); game.save.flush();
  }
  const onStationClose = () => {
    if (game.scenes.name !== "street") return;
    refreshBal(); push = null; doorGlow = 0; busy = false; inHall = false; flash(false);
    player.walkTo(null); player.pos.set(0, 0, GATE_Z + 2.2); player.heading = 0;
    card(tl(C.things.tower.label), t("عدت إلى الشارع", "Back on the street"));
  };
  game.bus.on("station-closed", onStationClose);
  $("#gm-act").addEventListener("click", () => { if (near) use(near); });
  game.input.on("action", () => { if (game.scenes.name === "street" && near && !busy && !game.ui.modalOpen) use(near); });
  let pending = null;
  const canWalk = () => !busy && !game.ui.modalOpen && game.scenes.name === "street";
  function walk(x, z) {
    if (!canWalk()) return false;
    const b = world.bounds; pending = null;
    player.walkTo({ x: Math.max(b.minX + 0.4, Math.min(b.maxX - 0.4, x)), z: Math.max(b.minZ + 0.4, Math.min(b.maxZ - 0.4, z)) });
    hideHelp(); return true;
  }
  game.input.on("tap", (p) => {
    if (!canWalk()) return;
    const r = canvas.getBoundingClientRect();
    const hit = scene.pick(((p.x + 1) / 2) * r.width, ((1 - p.y) / 2) * r.height, pickable, false, camera);
    if (!hit?.hit) return;
    const th = hit.pickedMesh.metadata?.thing;
    if (th) { pending = th; player.walkTo(th.at); hideHelp(); } else walk(hit.pickedPoint.x, hit.pickedPoint.z);
  });
  player.onArrive = () => { if (pending) { const th = pending; pending = null; use(th); } };

  // ---------- camera: behind and above the player, looking up the street at the tower ----------
  const camT = new Vector3(), camP = new Vector3(), look = new Vector3();
  const frame = () => { const r = canvas.getBoundingClientRect(); const asp = r.width / Math.max(1, r.height); camera.fov = (asp < 0.8 ? 64 : 50) * Math.PI / 180; engine.resize(); };
  const onResize = () => frame(); addEventListener("resize", onResize);
  const goalCam = () => {
    const r = canvas.getBoundingClientRect(), portrait = r.width / Math.max(1, r.height) < 0.8, bk = portrait ? 8.4 : 7.2;
    let up = portrait ? 3.7 : 3.2, cz = player.pos.z + bk;
    // never inside the apartment block behind you: stop at its face and rise instead, looking down over your shoulder
    const lim = HOME_Z - 0.6; if (cz > lim) { up += (cz - lim) * 0.3; cz = lim; }
    camP.set(player.pos.x * 0.55, up, cz);
    // aim a few metres ahead of the player, near the ground: the player sits in the lower middle of the frame, clear of
    // the dialogue box, with the street and the tower's entrance opening up ahead
    // v2C: aim higher and further, the tower stays in frame. Phase 2C.2: a little higher again in portrait (about 3°,
    // where the player has ~15° of room under them); barely in landscape, where the help line sits close under the feet
    camT.set(player.pos.x * 0.35, portrait ? 2.4 : 1.8, player.pos.z - 9);
  };
  // ---------- Phase 2C.2: a short glance up at the tower ----------
  // The crown (68-88 m up, 13-50 m away) can't share a street-level frame with the player, so the camera looks up at it
  // now and then instead: tilt up, hold, settle back, on the same camera and the same smoothing as the follow view.
  // At most twice per visit (once when the player first stops after walking a few metres, once after a long idle), never
  // during the intro, a door push, a dialogue or a modal; moving cancels it and the camera eases back from wherever it is.
  const GZ = { up: 1.7, hold: 1.5, down: 1.6, max: 2, gap: 30 };
  const gaze = { t: -1, g: 0, raw: 0, n: 0, last: -99, still: 0, from: null, walked: false, clock: 0 };
  const gazeT = new Vector3(), gazeDir = new Vector3(), followT = new Vector3();
  const crownY = (tower.topY || 80) + 6; // between the gold ring and the coin
  const startGaze = () => { if (gaze.t >= 0) return false; gaze.t = 0; gaze.n++; gaze.last = gaze.clock; return true; };
  const cancelGaze = () => { if (gaze.t >= 0 && gaze.t < GZ.up + GZ.hold) gaze.t = GZ.up + GZ.hold + (1 - gaze.raw) * GZ.down; };
  const gazeAim = () => {
    // a direction from the camera that puts the crown a little above the middle of the frame, clear of the objective card
    const cx = -camP.x, cy = crownY - camP.y, cz = CORE_Z - camP.z, flat = Math.hypot(cx, cz);
    const half = camera.fov / 2, pitch = Math.min(1.25, Math.atan2(cy, flat) - half * 0.25), yaw = Math.atan2(cx, cz);
    gazeDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const d = Vector3.Distance(camP, camT); camP.addToRef(gazeDir.scaleInPlace(d), gazeT);
  };
  const stepGaze = (dt, moving) => {
    gaze.clock += dt;
    if (!gaze.from) gaze.from = { x: player.pos.x, z: player.pos.z };
    if (!gaze.walked && Math.hypot(player.pos.x - gaze.from.x, player.pos.z - gaze.from.z) > 3) gaze.walked = true;
    const blocked = busy || !!push || !!intro || game.ui.modalOpen;
    gaze.still = moving || blocked ? 0 : gaze.still + dt;
    if (blocked) { gaze.t = -1; gaze.g = gaze.raw = 0; return; }
    if (moving) cancelGaze();
    else if (gaze.t < 0 && gaze.n < GZ.max && gaze.clock - gaze.last > GZ.gap && player.pos.z > GATE_Z + 8 &&
      ((gaze.n === 0 && gaze.walked && gaze.still > 1.0) || gaze.still > 8)) startGaze();
    if (gaze.t < 0) { gaze.g = gaze.raw = 0; return; }
    gaze.t += dt;
    const T = GZ.up + GZ.hold + GZ.down, t = gaze.t;
    const raw = t < GZ.up ? t / GZ.up : t < GZ.up + GZ.hold ? 1 : Math.max(0, 1 - (t - GZ.up - GZ.hold) / GZ.down);
    gaze.raw = raw; gaze.g = raw * raw * (3 - 2 * raw);
    if (t >= T) { gaze.t = -1; gaze.g = gaze.raw = 0; gaze.still = 0; }
  };
  goalCam();
  let intro = !back ? { k: 0 } : null;
  if (intro) { camera.position.set(0, 2.2, HOME_Z - 2.4); look.copyFrom(tower.lookAt); } else { camera.position.copyFrom(camP); look.copyFrom(camT); }
  camera.setTarget(look);

  game.street = { lookUp: () => (busy || push || intro ? false : startGaze()), use: (id) => { const th = things.find((x) => x.id === id); if (th) return use(th); }, walk, player, gate: GATE_Z, home: HOME_Z, engine: "babylon", state: () => ({ busy, intro: !!intro, target: player.target && { x: player.target.x, z: player.target.z }, locked: player.locked, near: near && near.id, gaze: { g: +gaze.g.toFixed(3), on: gaze.t >= 0, n: gaze.n }, salma: !!game.save.flag("story.salma"), sada: !!game.save.flag("story.sada"), signal: sigLive(), sigAt: { x: sig.at.x, z: sig.at.z } }) }; // the game's own tests

  await scene.whenReadyAsync();
  game.canvas.style.visibility = "hidden";

  return {
    scene: null, camera: null, engine: "babylon",
    enter() {
      frame(); game.audio.music("room"); game.audio.ambient("city"); saveSpot();
      requestAnimationFrame(() => flash(false));
      if (intro) {
        busy = true; card(tl(C.title), tl(C.name));
        setTimeout(async () => {
          intro.k = 0.0001; await wait(1600);
          if (!game.save.flag("street.intro")) { await game.ui.dialog(C.intro.map((l) => fill(tl(l), { name })), tl(C.narrator)); game.save.set({ flags: { "street.intro": true } }); }
          busy = false; intro = null;
        }, 500);
      }
      requestAnimationFrame(() => $("#gm-obj").classList.add("on"));
    },
    update(dt, time) {
      const mv = game.input.update();
      if (Math.abs(mv.x) + Math.abs(mv.y) > 0.1) hideHelp();
      // feet on the ground: the road, the pavement a kerb higher, the tower's podium
      const px = player.pos.x, pz = player.pos.z;
      const gy = Math.hypot(px, pz - CORE_Z) < 15 ? 0.14 : Math.abs(px) > ROAD + 0.12 ? 0.16 : 0;
      player.pos.y = (player.pos.y || 0) + (gy - (player.pos.y || 0)) * Math.min(1, dt * 14);
      player.update(dt, busy ? STILL : mv, 0, world);
      if (salma) { salma.update(dt, STILL, 0, null); salma.body.position.y = 0.14; }
      let best = null, bd = 1.6;
      const live = sigLive(); sig.m.isVisible = sig.h.isVisible = live;
      sig.screenM.emissiveIntensity = live ? 0.55 + Math.max(0, Math.sin(time * 9.0) * Math.sin(time * 2.3)) * 1.4 : 0.05;
      for (const th of things) {
        if (th === sig && !live) continue;
        const d = Math.hypot(th.at.x - player.pos.x, th.at.z - player.pos.z); if (d < bd) { bd = d; best = th; }
        th.m.position.y = th.mark.y + Math.sin(time * 2.2 + th.mark.z) * 0.12; th.m.rotation.y += dt * 1.6;
        th.h.material.alpha += (((th === best) ? 0.9 : 0) - th.h.material.alpha) * Math.min(1, dt * 8);
      }
      if (best !== near) { near = best; if (!busy) { showAct(near); if (near) game.audio.sfx("hover"); } }
      if (busy && !$("#gm-act").hidden) showAct(null);
      // people on the pavements: up and down their lane, stopping to let you pass
      for (const h of walkers) {
        const dp = Math.hypot(h.pos.x - player.pos.x, h.pos.z - player.pos.z);
        if (h.pause > 0) h.pause -= dt;
        if (dp < 1.5) { h.walkTo(null); h.face(player.pos.x, player.pos.z); h.pause = 0.8; }
        else if (h.pause <= 0 && !h.target) { const zz = h.dir < 0 ? GATE_Z + 7 : HOME_Z - 2; h.walkTo({ x: h.lane, z: zz }); h.onArrive = () => { h.dir = -h.dir; h.pause = 1 + Math.random() * 2; }; }
        h.update(dt, STILL, 0, null); h.body.position.y = 0.16;
      }
      tower.update(dt, doorGlow);
      if (!busy && !leaving) { spotT += dt; if (spotT > 8) { spotT = 0; saveSpot(); } }
      // camera
      goalCam();
      stepGaze(dt, Math.abs(mv.x) + Math.abs(mv.y) > 0.1 || !!player.target);
      if (gaze.g > 0) { gazeAim(); followT.copyFrom(camT); Vector3.LerpToRef(followT, gazeT, gaze.g, camT); }
      if (push) {
        push.k = Math.min(1, push.k + dt * 0.95); const e = push.k * push.k * (3 - 2 * push.k);
        Vector3.LerpToRef(push.from, push.to, e, camera.position); Vector3.LerpToRef(push.lf, push.look, e, look);
      } else if (intro && intro.k > 0) {
        intro.k = Math.min(1, intro.k + dt * 0.5); const e = intro.k * intro.k * (3 - 2 * intro.k), a = Math.min(1, dt * (0.5 + e * 3));
        Vector3.LerpToRef(camera.position, camP, a, camera.position); Vector3.LerpToRef(look, camT, a, look);
      } else if (!intro) { Vector3.LerpToRef(camera.position, camP, Math.min(1, dt * 3), camera.position); Vector3.LerpToRef(look, camT, Math.min(1, dt * 3.5), look); }
      camera.setTarget(look);
      scene.render();
    },
    exit() { flash(false); if (!leaving) saveSpot(); game.save.flush(); },
    dispose() {
      game.street?.tower?.close(); game.street = null; game.bus.off("station-closed", onStationClose); game.input.clear();
      removeEventListener("resize", onResize);
      try { scene.dispose(); engine.dispose(); } catch (e) { console.warn(e); }
      canvas.remove(); game.canvas.style.visibility = "";
    }
  };
}
