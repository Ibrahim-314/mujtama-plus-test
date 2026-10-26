/* Chapter 0 — the player's apartment, forty floors above the Digital City. v2.98 on Babylon.js, polished the same way
 * as the street: PBR materials (lacquered oak floor with a clear coat, plaster, brushed aluminium, glass) lit by an HDR
 * environment, a cool moon through the window casting real shadows across the room, warm lamps, the monitor's glow,
 * a glow layer for the neon strips and markers, filmic tone mapping, FXAA and (high tier) ambient occlusion.
 * The city outside is the same painted parallax view in the window glass (world/windowview.js), now drawn by a Babylon
 * shader. The furniture is Kenney's Furniture Kit (CC0), the workstation is procedural.
 * The game logic is the classic room's (scenes/room-classic.js, which still runs when Babylon can't start): the same
 * coordinates, things, HUD, goals, dialogue, MJT OS on the monitor, the door to the street and the game.room test hooks. */
import { makeEngine, Models, glowMat, Scene, Color3, Color4, Vector3, PBRMaterial, StandardMaterial, Texture, DynamicTexture } from "../bjs/core.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer.js";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.js";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Hero, spawnCharacter } from "../bjs/hero.js";
import { charUrl } from "../world/player.js";
import { windowLayers, windowFragment } from "../world/windowview.js";
import { paintFloor, paintBlob, paintCurtain, paintArt, paintWall } from "../world/roomart.js";
import { PALETTE, ASSET, charById } from "../config.js";
import { t, tl, fill } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";
import { openPause } from "../ui/menus.js";
import { CHAPTER0 as C } from "../story/chapter0.js";
import { openOS } from "../os/desktop.js";
import "../os/apps.js";

const W = 4, D = 3, H = 3, TH = 0.16; // half width (x), half depth (z), wall height, wall thickness
const WIN = { x0: -1.7, x1: 1.7, y0: 0.75, y1: 2.65 };
const DOOR = { z0: 1.0, z1: 2.1, h: 2.2 };
const STILL = { x: 0, y: 0, run: false };
const hex = (n) => "#" + n.toString(16).padStart(6, "0");

function canBabylon() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export async function create(game, params = {}) {
  if (!canBabylon() || game.forceClassicRoom) return (await import("./room-classic.js")).create(game, params);
  try { return await createBabylon(game, params); } catch (e) {
    console.error("[room] babylon failed, classic room", e);
    document.querySelector(".gm-bjs")?.remove(); game.canvas.style.visibility = "";
    return (await import("./room-classic.js")).create(game, params);
  }
}

async function createBabylon(game, params) {
  const save = game.save.data || {}, name = save.name || "";
  const q = game.renderer.q, tier = game.renderer.tier, low = tier === "low", high = tier === "high";
  const { canvas, engine } = makeEngine(game.surface, q);
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.03, 0.035, 0.08, 1); // v2C: deep night blue around the cut-away room, not a black void
  scene.skipPointerMovePicking = true; scene.skipPointerDownPicking = true; scene.skipPointerUpPicking = true;
  scene.detachControl?.();
  const models = new Models(scene);
  const post = !low; // the post pipeline does the tone mapping; without it every material does its own
  const canvasTex = (cv, nm, wrap = false, mip = true) => { const tx = new DynamicTexture(nm, cv, scene, mip); tx.update(true); tx.wrapU = tx.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE; tx.anisotropicFilteringLevel = 8; return tx; };
  const pbr = (nm, col, rough, metal, o = {}) => { const m = new PBRMaterial(nm, scene); m.albedoColor = Color3.FromHexString(col); m.roughness = rough; m.metallic = metal; Object.assign(m, o); return m; };

  // ---------- light: night through the window (moon + the city's violet glow), warm lamps inside ----------
  const env = CubeTexture.CreateFromPrefilteredData(ASSET("city/sky.env"), scene);
  scene.environmentTexture = env; scene.environmentIntensity = 0.3;
  const hemi = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  hemi.diffuse = Color3.FromHexString("#6a72b8"); hemi.groundColor = Color3.FromHexString("#2a1c14"); hemi.intensity = 0.52; // walls read as walls, not black
  const MOON = new Vector3(0.25, -0.62, 0.74).normalize();
  const moon = new DirectionalLight("moon", MOON, scene); moon.position = MOON.scale(-14); moon.diffuse = Color3.FromHexString("#9db2ff"); moon.intensity = 1.5;
  let shadows = null;
  if (!low) {
    shadows = new ShadowGenerator(high ? 2048 : 1024, moon);
    shadows.usePercentageCloserFiltering = true; shadows.filteringQuality = high ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    shadows.bias = 0.0008; shadows.normalBias = 0.02; shadows.darkness = 0.32;
    moon.shadowMinZ = 1; moon.shadowMaxZ = 40; moon.autoUpdateExtends = true; moon.autoCalcShadowZBounds = true;
  }
  const cast = (m) => { if (shadows && m) shadows.addShadowCaster(m, false); };
  const point = (nm, col, k, range, x, y, z) => { const l = new PointLight(nm, new Vector3(x, y, z), scene); l.diffuse = Color3.FromHexString(col); l.specular = l.diffuse.scale(0.6); l.intensity = k; l.range = range; return l; };
  point("city", "#a685ff", 2.6, 8, 0, 1.8, -2.3);
  point("lampL", "#ffa860", 2.2, 5, -1.85, 1.0, -2.55);
  point("lampF", "#ffc285", 2.6, 6, -3.6, 1.6, 2.45);
  point("desk", "#ffe0b0", 1.1, 3.2, 2.6, 2.2, -1.0); // v2C: a soft key over the workstation, so the computer reads at a glance
  const monGlow = point("mon", hex(PALETTE.cyan), 0.8, 3.5, 3.15, 1.15, -1.55);
  const spillLight = point("spill", "#ffd59a", 0, 6, W - 0.5, 1.5, (DOOR.z0 + DOOR.z1) / 2);

  // ---------- the room shell ----------
  const glowCache = new Map(), glow1 = (col, k) => { const key = col + k; if (!glowCache.has(key)) glowCache.set(key, glowMat(scene, col, k, "neon")); return glowCache.get(key); };
  const strip = (a, b, col, k = 1.2, th = 0.035) => {
    const d = b.subtract(a), len = d.length(), m = CreateBox("strip", { width: len, height: th, depth: th }, scene);
    m.material = glow1(typeof col === "number" ? hex(col) : col, k); m.position = a.add(d.scale(0.5));
    m.rotation.y = -Math.atan2(d.z, d.x); m.rotation.z = Math.atan2(d.y, Math.hypot(d.x, d.z)); m.isPickable = false; return m;
  };
  const box = (nm, w, h, d, x, y, z, mat, o = {}) => { const m = CreateBox(nm, { width: w, height: h, depth: d }, scene); m.position.set(x, y, z); m.material = mat; m.isPickable = false; if (o.recv !== false) m.receiveShadows = true; if (o.cast) cast(m); return m; };

  const ft = paintFloor(q.dpr > 1.5 && !low ? 2048 : 1024);
  const woodTex = canvasTex(ft.cv, "oak", true), roughTex = canvasTex(ft.rc, "oakR", true);
  woodTex.uScale = woodTex.vScale = roughTex.uScale = roughTex.vScale = 2;
  const floorM = pbr("floor", "#e2c9b4", 1, 0.02, { albedoTexture: woodTex, metallicTexture: roughTex, useRoughnessFromMetallicTextureGreen: true, useMetallnessFromMetallicTextureBlue: false, useRoughnessFromMetallicTextureAlpha: false });
  if (!low) { floorM.clearCoat.isEnabled = true; floorM.clearCoat.intensity = 0.35; floorM.clearCoat.roughness = 0.22; }
  const floor = CreateGround("floor", { width: W * 2, height: D * 2 }, scene); floor.material = floorM; floor.receiveShadows = true; floor.metadata = { floor: true };
  // the diorama base: a thick dark slab with a thin gold edge, so the room reads as a crafted model
  box("slab", W * 2 + TH * 2 + 0.2, 0.5, D * 2 + TH + 0.2, 0, -0.251, -TH / 2, pbr("slabM", "#14121f", 0.45, 0.4), { recv: false });
  strip(new Vector3(-W - TH - 0.1, -0.02, D + 0.1), new Vector3(W + TH + 0.1, -0.02, D + 0.1), PALETTE.gold, 0.9, 0.02);
  const plaster = canvasTex(paintWall(), "plaster", true); plaster.uScale = 2; plaster.vScale = 1.4;
  const wallM = pbr("wall", "#d8d0ee", 0.9, 0, { albedoTexture: plaster });
  const wall = (w, h, d, x, y, z) => box("wall", w, h, d, x, y, z, wallM, { cast: true });
  const bz = -D - TH / 2;
  wall(WIN.x0 + W, H, TH, (-W + WIN.x0) / 2, H / 2, bz);
  wall(W - WIN.x1, H, TH, (W + WIN.x1) / 2, H / 2, bz);
  wall(WIN.x1 - WIN.x0, WIN.y0, TH, (WIN.x0 + WIN.x1) / 2, WIN.y0 / 2, bz);
  wall(WIN.x1 - WIN.x0, H - WIN.y1, TH, (WIN.x0 + WIN.x1) / 2, (H + WIN.y1) / 2, bz);
  wall(TH, H, D * 2, -W - TH / 2, H / 2, 0);
  const rx = W + TH / 2;
  wall(TH, H, DOOR.z0 + D, rx, H / 2, (-D + DOOR.z0) / 2);
  wall(TH, H, D - DOOR.z1, rx, H / 2, (D + DOOR.z1) / 2);
  wall(TH, H - DOOR.h, DOOR.z1 - DOOR.z0, rx, (H + DOOR.h) / 2, (DOOR.z0 + DOOR.z1) / 2);
  // the door: brushed steel slab in a dark frame, a status LED strip and a keypad
  const door = box("door", 0.06, DOOR.h, DOOR.z1 - DOOR.z0, W - 0.02, DOOR.h / 2, (DOOR.z0 + DOOR.z1) / 2, pbr("doorM", "#2a2f4d", 0.38, 0.65), { cast: true });
  const jambM = pbr("jamb", "#0d0c16", 0.35, 0.55);
  box("jamb", 0.09, DOOR.h + 0.08, 0.06, W - 0.03, (DOOR.h + 0.08) / 2, DOOR.z0 - 0.03, jambM); box("jamb", 0.09, DOOR.h + 0.08, 0.06, W - 0.03, (DOOR.h + 0.08) / 2, DOOR.z1 + 0.03, jambM);
  box("jamb", 0.09, 0.06, DOOR.z1 - DOOR.z0 + 0.12, W - 0.03, DOOR.h + 0.05, (DOOR.z0 + DOOR.z1) / 2, jambM);
  const ledM = glowMat(scene, hex(PALETTE.red), 1.5, "doorLed"), padM = glowMat(scene, hex(PALETTE.red), 1.3, "doorPad");
  const doorLed = strip(new Vector3(W - 0.07, 0.25, DOOR.z0 + 0.12), new Vector3(W - 0.07, DOOR.h - 0.25, DOOR.z0 + 0.12), PALETTE.red, 1.5, 0.03); doorLed.material = ledM;
  const doorPad = CreatePlane("doorPad", { width: 0.16, height: 0.24, sideOrientation: 2 }, scene); doorPad.material = padM; doorPad.position.set(W - 0.09, 1.25, DOOR.z0 - 0.22); doorPad.rotation.y = -Math.PI / 2; doorPad.isPickable = false;
  const setLed = (col, k) => { ledM.emissiveColor = Color3.FromHexString(col).scale(k); };
  const setPad = (r, g, b) => { padM.emissiveColor = new Color3(r, g, b); };
  const padRed = () => setPad(...Color3.FromHexString(hex(PALETTE.red)).scale(1.3).asArray());
  if (game.save.flag("room.done")) { setLed(hex(PALETTE.gold), 1.8); setPad(0.3, 1.6, 0.75); }
  const doorZ = door.position.z; let doorK = 0, doorGoal = 0;
  const spillM = glowMat(scene, "#ffe0a8", 1.6, "spill"); spillM.alpha = 0;
  const spill = CreatePlane("spill", { width: DOOR.z1 - DOOR.z0, height: DOOR.h, sideOrientation: 2 }, scene); spill.material = spillM; spill.position.set(W + TH - 0.02, DOOR.h / 2, (DOOR.z0 + DOOR.z1) / 2); spill.rotation.y = -Math.PI / 2; spill.isPickable = false;

  // the window: a deep reveal, black aluminium frame and mullions, the city in the glass, a stone sill
  const frameM = pbr("frame", "#0c0e1a", 0.32, 0.75);
  const bar = (w, h, x, y) => box("mullion", w, h, 0.08, x, y, -D - 0.02, frameM, { cast: true });
  bar(WIN.x1 - WIN.x0 + 0.1, 0.07, 0, WIN.y0); bar(WIN.x1 - WIN.x0 + 0.1, 0.07, 0, WIN.y1); bar(0.06, WIN.y1 - WIN.y0, 0, (WIN.y0 + WIN.y1) / 2);
  bar(0.06, WIN.y1 - WIN.y0, WIN.x0 + (WIN.x1 - WIN.x0) / 4, (WIN.y0 + WIN.y1) / 2); bar(0.06, WIN.y1 - WIN.y0, WIN.x1 - (WIN.x1 - WIN.x0) / 4, (WIN.y0 + WIN.y1) / 2);
  bar(0.07, WIN.y1 - WIN.y0 + 0.07, WIN.x0, (WIN.y0 + WIN.y1) / 2); bar(0.07, WIN.y1 - WIN.y0 + 0.07, WIN.x1, (WIN.y0 + WIN.y1) / 2);
  const ly = windowLayers({ hi: q.dpr > 1.5 && !low });
  const glassM = new ShaderMaterial("cityGlass", scene, {
    vertexSource: "precision highp float; attribute vec3 position; attribute vec2 uv; uniform mat4 world; uniform mat4 viewProjection; varying vec3 vW; varying vec2 vU; void main(){ vU = uv; vec4 w = world * vec4(position, 1.0); vW = w.xyz; gl_Position = viewProjection * w; }",
    fragmentSource: "precision highp float; uniform vec3 uCam;\n" + windowFragment("uCam", post ? "gl_FragColor.rgb = pow(max(gl_FragColor.rgb, vec3(0.0)), vec3(2.2)) * 0.95;" : "")
  }, { attributes: ["position", "uv"], uniforms: ["world", "viewProjection", "uCam", "uTime"], samplers: ["tFar", "tMid", "tNear", "tCore"] });
  for (const [k, cv] of [["tFar", ly.far], ["tMid", ly.mid], ["tNear", ly.near], ["tCore", ly.core]]) glassM.setTexture(k, canvasTex(cv, k));
  glassM.backFaceCulling = false; glassM.setFloat("uTime", 0);
  const glass = CreatePlane("glass", { width: WIN.x1 - WIN.x0, height: WIN.y1 - WIN.y0 }, scene); glass.material = glassM; glass.position.set(0, (WIN.y0 + WIN.y1) / 2, -D - 0.03); glass.isPickable = false;
  box("sill", WIN.x1 - WIN.x0 + 0.3, 0.05, 0.3, 0, WIN.y0 - 0.01, -D + 0.12, pbr("sillM", "#3a3746", 0.3, 0.1));

  // neon: ceiling-edge strips (cyan), baseboard (gold), window outline (magenta) — softer than before, the glow layer does the rest
  strip(new Vector3(-W + 0.05, H - 0.06, -D + 0.05), new Vector3(W - 0.05, H - 0.06, -D + 0.05), PALETTE.cyan, 0.75);
  strip(new Vector3(-W + 0.05, H - 0.06, -D + 0.05), new Vector3(-W + 0.05, H - 0.06, D), PALETTE.cyan, 0.75);
  strip(new Vector3(W - 0.05, H - 0.06, -D + 0.05), new Vector3(W - 0.05, H - 0.06, D), PALETTE.cyan, 0.75);
  strip(new Vector3(-W + 0.03, 0.04, -D + 0.03), new Vector3(W - 0.03, 0.04, -D + 0.03), PALETTE.gold, 0.8, 0.025);
  strip(new Vector3(-W + 0.03, 0.04, -D + 0.03), new Vector3(-W + 0.03, 0.04, D), PALETTE.gold, 0.8, 0.025);
  strip(new Vector3(WIN.x0, WIN.y1 + 0.06, -D + 0.06), new Vector3(WIN.x1, WIN.y1 + 0.06, -D + 0.06), PALETTE.magenta, 1.0, 0.03);

  // ---------- finishing: wainscot with grooves, chair rail, crown caps, curtains, framed prints ----------
  const wainM = pbr("wain", "#1d1a2c", 0.5, 0.08), trimM = pbr("trim", "#0f0d18", 0.32, 0.5), capM = pbr("cap", "#0b0a12", 0.4, 0.4);
  const WH = 0.85;
  box("wain", W + WIN.x0 - 0.02, WH, 0.03, (-W + WIN.x0) / 2, WH / 2, -D + 0.015, wainM);
  box("wain", W - WIN.x1 - 0.02, WH, 0.03, (W + WIN.x1) / 2, WH / 2, -D + 0.015, wainM);
  box("wain", 0.03, WH, D * 2, -W + 0.015, WH / 2, 0, wainM);
  for (let gx = -W + 0.5; gx < W; gx += 0.5) if (gx < WIN.x0 - 0.05 || gx > WIN.x1 + 0.05) box("groove", 0.015, WH - 0.12, 0.01, gx, WH / 2, -D + 0.035, trimM);
  for (let gz = -D + 0.5; gz < D; gz += 0.5) box("groove", 0.01, WH - 0.12, 0.015, -W + 0.035, WH / 2, gz, trimM);
  box("rail", W * 2, 0.04, 0.05, 0, WH, -D + 0.025, trimM); box("rail", 0.05, 0.04, D * 2, -W + 0.025, WH, 0, trimM);
  box("cap", W * 2 + TH * 2, 0.04, TH + 0.02, 0, H + 0.02, -D - TH / 2, capM);
  box("cap", TH + 0.02, 0.04, D * 2 + TH, -W - TH / 2, H + 0.02, -TH / 2, capM);
  box("cap", TH + 0.02, 0.04, D * 2 + TH, W + TH / 2, H + 0.02, -TH / 2, capM);
  const curM = pbr("curtain", "#ffffff", 0.95, 0, { albedoTexture: canvasTex(paintCurtain(), "curtainT"), backFaceCulling: false });
  curM.sheen.isEnabled = !low; curM.sheen.intensity = 0.4; curM.sheen.color = Color3.FromHexString("#c9a0ff");
  for (const cx of [WIN.x0 - 0.22, WIN.x1 + 0.22]) box("curtain", 0.5, WIN.y1 - WIN.y0 + 0.45, 0.06, cx, (WIN.y0 + WIN.y1) / 2 + 0.1, -D + 0.1, curM, { cast: true });
  box("rod", WIN.x1 - WIN.x0 + 1.2, 0.025, 0.025, 0, WIN.y1 + 0.28, -D + 0.12, pbr("rodM", "#b9a27a", 0.3, 0.9));
  const prints = [];
  const artFrame = (kind, x, y, w, h) => {
    box("artFrame", w + 0.07, h + 0.07, 0.035, x, y, -D + 0.02, trimM);
    const tx = canvasTex(paintArt(kind), "art" + kind);
    const m = pbr("print" + kind, "#ffffff", 0.45, 0, { albedoTexture: tx, emissiveTexture: tx, emissiveColor: new Color3(0.14, 0.14, 0.14) });
    const a = CreatePlane("art", { width: w, height: h }, scene); a.material = m; a.position.set(x, y, -D + 0.04); a.isPickable = false; prints.push(a);
  };
  artFrame(0, -2.95, 1.75, 0.62, 0.78); artFrame(1, 3.0, 1.85, 0.5, 0.62);

  // ---------- furniture (CC0 Kenney Furniture Kit), sized and grounded like the classic room's place() ----------
  const colliders = [];
  async function place(nm, o) {
    const ct = await models.get(ASSET(`models/${nm}.glb`));
    const e = ct.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    const inner = e.rootNodes[0], wrap = new TransformNode(nm, scene); inner.parent = wrap;
    const bb = () => { wrap.computeWorldMatrix(true); for (const m of wrap.getChildMeshes(false)) m.computeWorldMatrix(true); return wrap.getHierarchyBoundingVectors(true); };
    let { min, max } = bb();
    const k = o.height ? o.height / ((max.y - min.y) || 1) : (o.size || 1) / (Math.max(max.x - min.x, max.z - min.z) || 1);
    inner.scaling.scaleInPlace(k);
    ({ min, max } = bb());
    inner.position.x -= (min.x + max.x) / 2; inner.position.z -= (min.z + max.z) / 2; inner.position.y -= min.y;
    wrap.rotation.y = o.rot || 0; wrap.position.set(o.x, o.y || 0, o.z);
    ({ min, max } = bb());
    const meshes = wrap.getChildMeshes(false);
    for (const m of meshes) { m.isPickable = false; m.receiveShadows = true; if (o.solid !== false) cast(m); }
    return { node: wrap, box: { min: { x: min.x, y: min.y, z: min.z }, max: { x: max.x, y: max.y, z: max.z } }, solid: o.solid !== false };
  }
  const items = await Promise.all([
    place("bedDouble", { x: -3.1, z: -1.95, size: 2.05 }),
    place("cabinetBedDrawerTable", { x: -1.85, z: -2.7, size: 0.5 }),
    place("lampSquareTable", { x: -1.85, z: -2.72, y: 0.48, height: 0.42, solid: false }),
    place("desk", { x: 3.35, z: -1.55, size: 1.5, rot: -Math.PI / 2 }),
    place("chairDesk", { x: 2.45, z: -1.5, size: 0.62, rot: Math.PI / 2 }),
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
  for (const it of items) if (it.solid) colliders.push(it.box);
  // contact shadows: a soft dark blob under every solid piece grounds it on the floor
  const blobT = canvasTex(paintBlob(), "blob");
  const blobM = new StandardMaterial("blobM", scene); blobM.diffuseColor = Color3.Black(); blobM.specularColor = Color3.Black(); blobM.emissiveColor = Color3.Black(); blobM.opacityTexture = blobT; blobM.disableLighting = true; blobM.alpha = 0.8; blobM.disableDepthWrite = true;
  const blobs = [];
  for (const it of items) {
    if (!it.solid) continue; const b = it.box, w = b.max.x - b.min.x, d = b.max.z - b.min.z;
    const s = CreateGround("blob", { width: w * 1.35, height: d * 1.35 }, scene); s.material = blobM; s.position.set((b.min.x + b.max.x) / 2, 0.004, (b.min.z + b.max.z) / 2); s.isPickable = false; blobs.push(s);
  }
  strip(new Vector3(3.0, 0.7, -2.2), new Vector3(3.0, 0.7, -0.9), PALETTE.cyan, 0.9, 0.02); // LED under the desk
  strip(new Vector3(-4, 0.06, -0.92), new Vector3(-2.1, 0.06, -0.92), PALETTE.magenta, 0.95, 0.03); // glow under the bed
  // the lamps' shades glow warm
  const shadeM = glowMat(scene, "#ffcf98", 0.9, "shade");
  const sh1 = CreateSphere("lampBulb", { diameter: 0.12, segments: 12 }, scene); sh1.material = shadeM; sh1.position.set(-1.85, 0.78, -2.72); sh1.isPickable = false;

  // ---------- the workstation: thin-bezel monitor on an aluminium stand, keyboard, mouse on a pad ----------
  let mining = null;
  // c0.mining is a verify "server" mission: the server checks its own mining record; the client only asks
  const minedOnce = (m) => { if (m && (m.session || Number(m.totals?.sessions) > 0)) game.missions?.complete("c0.mining"); };
  game.host.api("GET", "/api/mjt/mining").then((m) => { mining = m; minedOnce(m); }).catch(() => { mining = null; });
  const live = (w, h, nm, draw) => { const tx = new DynamicTexture(nm, { width: w, height: h }, scene, true); const x = tx.getContext(); return { tx, tick(time) { draw(x, w, h, time); tx.update(true); } }; };
  const scr = live(512, 320, "miner", (x, w, h, time) => {
    x.save(); x.scale(2, 2); w /= 2; h /= 2;
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
    x.restore();
  });
  const SW = 0.62, SH = 0.38;
  const deskItem = items[3], deskTop = deskItem?.box?.max?.y || 0.76;
  const scrPos = new Vector3(3.575, deskTop + 0.34, -1.55);
  const alu = pbr("alu", "#c3c7cf", 0.28, 0.9), aluDark = pbr("aluD", "#8d929c", 0.36, 0.88);
  const blackGlass = pbr("bglass", "#07080b", 0.08, 0.3), shell = pbr("shell", "#d9dbe0", 0.4, 0.6);
  const keyM = pbr("key", "#101217", 0.6, 0.15), padMat = pbr("pad", "#14151b", 0.95, 0), kbM = pbr("kb", "#3b3f47", 0.32, 0.82);
  const mon = new TransformNode("monitor", scene); mon.position.copyFrom(scrPos); mon.rotation.y = -Math.PI / 2;
  const part = (nm, w, h, d, m, x, y, z, parent) => { const o = box(nm, w, h, d, x, y, z, m, { cast: true }); o.parent = parent; return o; };
  part("bezel", SW + 0.016, SH + 0.032, 0.012, blackGlass, 0, -0.008, -0.007, mon);
  part("shell", SW + 0.02, SH + 0.036, 0.016, shell, 0, -0.008, -0.02, mon);
  part("hump", 0.5, 0.27, 0.03, shell, 0, -0.01, -0.04, mon);
  const ledOn = part("led", 0.008, 0.003, 0.002, glowMat(scene, "#5cf2ff", 1.4, "monLed"), 0.27, -0.205, -0.0005, mon); ledOn.receiveShadows = false;
  const neck = part("neck", 0.07, 0.31, 0.014, alu, 0, -0.19, -0.085, mon); neck.rotation.x = -0.16;
  part("hinge", 0.075, 0.035, 0.03, aluDark, 0, -0.06, -0.065, mon);
  const base = CreateCylinder("monBase", { diameterTop: 0.22, diameterBottom: 0.23, height: 0.012, tessellation: 40 }, scene); base.material = alu; base.parent = mon; base.scaling.set(1.2, 1, 0.85); base.position.set(0, -0.334, -0.075); base.isPickable = false; base.receiveShadows = true;
  const screenM = new StandardMaterial("screenM", scene); screenM.emissiveTexture = scr.tx; screenM.diffuseColor = Color3.Black(); screenM.specularColor = Color3.Black(); screenM.disableLighting = true;
  const screen = CreatePlane("screen", { width: SW, height: SH }, scene); screen.material = screenM; screen.parent = mon; screen.position.set(0, 0, -0.0005); screen.isPickable = false;
  const kb = new TransformNode("keyboard", scene); kb.position.set(3.2, deskTop + 0.002, -1.55); kb.rotation.y = -Math.PI / 2;
  const kbBody = part("kbBody", 0.43, 0.012, 0.135, kbM, 0, 0.006, 0, kb); kbBody.rotation.x = 0.04;
  const key0 = CreateBox("key", { width: 0.0235, height: 0.006, depth: 0.0225 }, scene); key0.material = keyM; key0.parent = kb; key0.isPickable = false; key0.position.set(0, -50, 0);
  const COLS = 15, P = 0.0272;
  const keyAt = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < COLS; c++) keyAt.push([(c - (COLS - 1) / 2) * P, (r - 2) * 0.0255, 1]);
  for (const c of [-6.5, -5.5, -4.5, 4.5, 5.5, 6.5]) keyAt.push([c * P, 2 * 0.0255, 1]);
  keyAt.push([0, 0.051, 8.2]);
  for (const [x, z, s] of keyAt) { const k = key0.createInstance("k"); k.parent = kb; k.position.set(x, 0.0145 - z * 0.04, z); k.scaling.x = s; }
  part("mousePad", 0.2, 0.003, 0.24, padMat, 0.34, 0.0015, 0.01, kb);
  const mouse = CreateSphere("mouse", { diameter: 2, segments: 14 }, scene); mouse.material = kbM; mouse.parent = kb; mouse.scaling.set(0.029, 0.014, 0.05); mouse.position.set(0.34, 0.006, 0.03); mouse.isPickable = false;

  // the city board: a holographic news panel on the left wall
  const news = live(1024, 512, "news", (x, w, h, time) => {
    x.save(); x.scale(2, 2); w /= 2; h /= 2;
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#160a33"); g.addColorStop(1, "#04121f"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(255,63,180,.9)"; x.lineWidth = 4; x.strokeRect(6, 6, w - 12, h - 12);
    x.direction = "rtl"; x.textAlign = "center"; x.fillStyle = "#ffc23d"; x.font = "bold 44px sans-serif"; x.fillText(t("المدينة الرقمية", "THE DIGITAL CITY"), w / 2, 70);
    x.fillStyle = "#eaf2ff"; x.font = "28px sans-serif"; x.fillText(fill(t("مرحباً {name}", "Welcome, {name}"), { name }), w / 2, 120);
    x.fillStyle = "#2fe6ff"; x.font = "bold 26px sans-serif"; const msg = [t("النواة تصدر MJT كل يوم", "The Core issues MJT daily"), t("التعدين: 5 MJT كل 24 ساعة", "Mining: 5 MJT every 24h"), t("قريباً: مجمّع التعدين والمتجر", "Soon: Mining Complex & Market")][Math.floor(time / 3.5) % 3];
    x.fillText(msg, w / 2, 190);
    x.fillStyle = "rgba(255,255,255,.05)"; for (let yy = (time * 40) % 6; yy < h; yy += 6) x.fillRect(0, yy, w, 2);
    x.restore();
  });
  const newsM = new StandardMaterial("newsM", scene); newsM.emissiveTexture = news.tx; newsM.diffuseColor = Color3.Black(); newsM.specularColor = Color3.Black(); newsM.disableLighting = true;
  const panel = CreatePlane("news", { width: 1.7, height: 0.85 }, scene); panel.material = newsM; panel.position.set(-W + 0.03, 1.9, -0.05); panel.rotation.y = Math.PI / 2; panel.isPickable = false;
  box("newsFrame", 0.02, 0.9, 1.75, -W + 0.015, 1.9, -0.05, trimM);
  scr.tick(0); news.tick(0);

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
  for (const th of things) {
    th.goal = C.goals.includes(th.id);
    const col = hex(th.goal ? PALETTE.gold : PALETTE.cyan);
    th.m = CreatePolyhedron("mark", { type: 1, size: 0.11 }, scene); th.m.material = glowMat(scene, col, 1.7, "mark"); th.m.position.copyFrom(th.mark); th.m.isPickable = false;
    th.h = CreateTorus("halo", { diameter: 0.66, thickness: 0.04, tessellation: 48 }, scene); const hm = glowMat(scene, col, 1.4, "halo"); hm.alpha = 0; hm.alphaMode = Constants.ALPHA_ADD; hm.disableDepthWrite = true; th.h.material = hm; th.h.position.set(th.at.x, 0.02, th.at.z); th.h.scaling.y = 0.2; th.h.isPickable = false;
    th.hit = CreateBox("hit", { width: 1.1, height: 1.8, depth: 1.1 }, scene); th.hit.position.set(th.mark.x, 0.9, th.mark.z); th.hit.isVisible = false; th.hit.metadata = { thing: th };
  }
  const pickable = (m) => m === floor || !!m.metadata?.thing;

  // ---------- the player ----------
  const ch = spawnCharacter(await models.get(charUrl(save.char || "hoodie")), 1.72, "hero");
  const player = new Hero(scene, ch, game.audio); for (const m of ch.meshes) { cast(m); m.receiveShadows = true; }
  const fromDoor = params.from === "door";
  const pos = fromDoor ? { x: W - 0.7, z: (DOOR.z0 + DOOR.z1) / 2, r: -Math.PI / 2 } : save.pos && !params.arrival && (save.scene || "room") === "room" ? save.pos : { x: -0.4, z: 0.9, r: Math.PI }; // a street position never lands in the room
  if (fromDoor) { doorK = 1; spillM.alpha = 0.95; spillLight.intensity = 4; setTimeout(() => { doorGoal = 0; game.audio.sfx("open"); }, 900); }
  player.pos.set(pos.x, 0, pos.z); player.heading = pos.r ?? Math.PI;
  const world = { colliders, bounds: { minX: -W + 0.05, maxX: W - 0.05, minZ: -D + 0.05, maxZ: D - 0.1 } };
  // every material sees all the room's lights (Babylon's default is four per material)
  for (const m of scene.materials) if ("maxSimultaneousLights" in m) m.maxSimultaneousLights = 8;

  // ---------- camera + post ----------
  const camera = new FreeCamera("cam", new Vector3(0, 6, 7.4), scene); camera.minZ = 0.05; camera.maxZ = 200; camera.inputs.clear();
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES; ip.exposure = 1.2; ip.contrast = 1.08;
  ip.vignetteEnabled = !low; ip.vignetteWeight = 2.2; ip.vignetteColor = new Color4(0.02, 0.01, 0.06, 0);
  let glow = null;
  if (!low) {
    glow = new GlowLayer("glow", scene, { mainTextureRatio: high ? 0.5 : 0.35, blurKernelSize: high ? 32 : 24 }); glow.intensity = 0.42; // v2C: the cyan cove lines no longer bloom over the walls
    for (const m of [glass, screen, panel, floor, ...prints, ...blobs]) glow.addExcludedMesh(m);
    const pipe = new DefaultRenderingPipeline("post", true, scene, [camera]);
    pipe.fxaaEnabled = true; pipe.samples = high ? 4 : 1;
    pipe.bloomEnabled = high; pipe.bloomThreshold = 0.9; pipe.bloomWeight = 0.12; pipe.bloomKernel = 48; pipe.bloomScale = 0.5;
    pipe.imageProcessingEnabled = true;
    if (high && engine.webGLVersion >= 2) {
      try { const ao = new SSAO2RenderingPipeline("ao", scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera], false); ao.radius = 0.6; ao.totalStrength = 1.1; ao.samples = 12; ao.maxZ = 30; ao.expensiveBlur = false; } catch (e) { console.warn("[room] ssao", e); }
    }
  }

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
  refreshBal(); paintObj(); game.missions?.paint();
  $("#gm-menu").addEventListener("click", () => openPause(game));
  game.input.on("pause", () => { if (game.scenes.name === "room" && !game.ui.modalOpen && !busy) openPause(game); });

  // ---------- interaction (same flow as the classic room) ----------
  let near = null, busy = false, cine = null, helpGone = false;
  const label = (th) => C.things[th.id];
  const showAct = (th) => { const a = $("#gm-act"); if (!th) { a.hidden = true; return; } $("#gm-act-k").textContent = tl(label(th).label); $("#gm-act-v").textContent = tl(label(th).verb); a.hidden = false; a.dataset.goal = th.goal ? "1" : ""; };
  const lines = (arr) => arr.map((l) => fill(tl(l), { name }));
  const look = new Vector3();
  async function use(th) {
    if (busy) return; busy = true; showAct(null); player.walkTo(null); player.face(th.face.x, th.face.z);
    try {
      if (th.id === "window") {
        cine = { from: camera.position.clone(), to: new Vector3(0.4, 1.75, -1.1), look: new Vector3(0, 1.9, -30), k: 0 };
        game.audio.sfx("whoosh"); await wait(900);
        await game.ui.dialog(lines(C.things.window.lines), tl(C.narrator)); cine = null;
      } else if (th.id === "computer") {
        await player.gesture("Interact");
        if (!done("computer")) await game.ui.dialog(lines(C.things.computer.first), tl(C.narrator));
        mark("computer"); busy = false; computer(); return;
      } else if (th.id === "door") {
        if (done("done")) { await openDoor(); return; }
        game.audio.sfx("locked"); setPad(2.4, 0.25, 0.4); await player.gesture("Interact");
        await game.ui.dialog(lines(C.things.door.lines), tl(C.narrator)); padRed();
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
    game.missions?.complete("c0.explore"); // Phase 2D-A: the server decides and grants the XP (story-flow check)
    card(tl(C.title) + " · " + tl(C.name), t("اكتمل", "Complete"));
    await player.gesture("Cheer"); await game.ui.dialog(lines(C.done), tl(C.narrator));
    setLed(hex(PALETTE.gold), 1.8); busy = false;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function openDoor() {
    showAct(null); setPad(0.3, 1.6, 0.75); setLed(hex(PALETTE.gold), 1.8);
    game.scenes.reg.street?.().catch(() => { });
    game.audio.sfx("open"); await player.gesture("Interact");
    card(tl(C.things.door.label), tl(C.things.door.open));
    doorGoal = 1;
    cine = { from: camera.position.clone(), to: new Vector3(W - 2.4, 1.8, (DOOR.z0 + DOOR.z1) / 2 + 0.55), look: new Vector3(W + 6, 1.25, (DOOR.z0 + DOOR.z1) / 2), k: 0, sp: 0.8 };
    await wait(1150);
    player.walkTo({ x: W - 0.25, z: (DOOR.z0 + DOOR.z1) / 2 });
    await wait(900);
    game.audio.sfx("whoosh"); game.root.classList.add("gm-flash-on"); await wait(380);
    game.save.set({ pos: { x: +(W - 0.7).toFixed(2), z: 1.55, r: -1.57 }, scene: "room", flags: { "room.out": true } }); lastSaved = "";
    game.missions?.complete("c0.leave");
    await game.scenes.go("street", { fade: 250, fadeIn: 700 });
  }
  function card(k, v) { const c = $("#gm-card"); c.querySelector("small").textContent = k; c.querySelector("b").textContent = v; c.hidden = false; c.classList.remove("on"); void c.offsetWidth; c.classList.add("on"); setTimeout(() => { c.hidden = true; }, 3600); }

  // the computer: OUTSIDE (the MJT OS desktop drawn on the monitor, in perspective) and INSIDE (the camera dives in and
  // the OS fills the display). While a view is still, the 3D loop pauses so the computer costs nothing.
  let osHook = null;
  const OSW = 960, OSH = Math.round(OSW * SH / SW);
  const aspect = () => { const r = canvas.getBoundingClientRect(); return r.width / Math.max(1, r.height); };
  function fitDist(cover, margin) {
    const vh = Math.tan(camera.fov / 2), hh = vh * aspect();
    const dW = SW / 2 / (hh * margin), dH = SH / 2 / (vh * margin);
    return cover ? Math.min(dW, dH) : Math.max(dW, dH);
  }
  const scrW = () => screen.getAbsolutePosition().clone();
  const viewAt = (d, up = 0) => { const s = scrW(); return new Vector3(s.x - d, s.y + up, s.z); };
  function quad(w, h, p) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3, den = dx1 * dy2 - dx2 * dy1;
    const g = (sx * dy2 - dx2 * sy) / den, k = (dx1 * sy - sx * dy1) / den;
    const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3, d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
    return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${k / h},0,0,1,0,${x0},${y0},0,1)`;
  }
  function computer() {
    busy = true; showAct(null);
    const pcOn = (on) => { game.root.classList.toggle("gm-pc", on); for (const th of things) th.m.isVisible = !on; };
    pcOn(true);
    let mode = "out", alive = true, lastT = "", settleT = 0;
    const os = openOS(game, {
      user: name,
      onOutside: () => goOut(),
      onClose: () => {
        alive = false; osHook = null; pcOn(false); removeEventListener("resize", onResize); clearTimeout(settleT);
        game.loop.pause(false); cine = null; busy = false; refreshBal();
        game.host.api("GET", "/api/mjt/mining").then((x) => { mining = x; minedOnce(x); }).catch(() => { });
      }
    });
    const panelEl = os.panel, wrap = panelEl.parentElement;
    wrap.classList.add("os-out"); panelEl.style.width = OSW + "px"; panelEl.style.height = OSH + "px";
    wrap.insertAdjacentHTML("beforeend", `<div class="os-cam">
      <button type="button" class="os-cb" data-c="exit" data-sfx="back">${icon("back")}<span>${esc(t("الغرفة", "Room"))}</span></button>
      <button type="button" class="os-cb in" data-c="in">${icon("full")}<span>${esc(t("ادخل الشاشة", "Enter the screen"))}</span></button></div>`);
    const placeOS = () => {
      const r = canvas.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      camera.setTarget(look);
      const vp = camera.viewport.toGlobal(r.width, r.height), tm = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
      const c = scrW();
      // the monitor faces -x: seen from the chair, +z is to the right
      const pts = [[-SW / 2, SH / 2], [SW / 2, SH / 2], [SW / 2, -SH / 2], [-SW / 2, -SH / 2]].map(([u, v]) => {
        const p = Vector3.Project(new Vector3(c.x, c.y + v, c.z + u), Matrix.IdentityReadOnly, tm, vp);
        return [p.x + r.left - wr.left, p.y + r.top - wr.top];
      });
      const tf = quad(OSW, OSH, pts); if (tf !== lastT) { panelEl.style.transform = tf; lastT = tf; }
    };
    const camTo = (p, sp, lyOff = 0) => new Promise((res) => {
      game.loop.pause(false); const s = scrW(); s.y += lyOff;
      cine = { from: camera.position.clone(), to: p, lf: look.clone(), look: s, k: 0, sp, t0: performance.now(), done: res };
    });
    const settle = () => { clearTimeout(settleT); settleT = setTimeout(() => { if (alive && cine && !cine.done) game.loop.pause(true); }, 60); };
    async function goOut(first) {
      mode = "out"; wrap.classList.remove("os-full"); wrap.classList.add("os-out"); osHook = placeOS;
      if (!first) { game.loop.pause(false); placeOS(); }
      panelEl.classList.add("os-fade"); requestAnimationFrame(() => panelEl.classList.remove("os-fade"));
      await camTo(viewAt(fitDist(false, aspect() < 0.8 ? 0.9 : 0.5), 0.13), first ? 1.1 : 1.6, -0.09);
      if (alive && mode === "out") { placeOS(); settle(); }
    }
    async function goIn() {
      if (mode !== "out") return; mode = "dive"; game.audio.sfx("whoosh");
      await camTo(viewAt(fitDist(true, 1) * 0.86), 1.5);
      if (!alive) return;
      mode = "in"; osHook = null; wrap.classList.remove("os-out"); wrap.classList.add("os-full"); panelEl.style.transform = ""; lastT = "";
      panelEl.classList.add("os-fade"); requestAnimationFrame(() => requestAnimationFrame(() => panelEl.classList.remove("os-fade")));
      settle();
    }
    const onResize = () => { if (!alive) return; if (mode === "out") { game.loop.pause(false); setTimeout(() => goOut(), 80); } };
    addEventListener("resize", onResize);
    wrap.addEventListener("click", (e) => {
      const c = e.target.closest("[data-c]")?.dataset.c;
      if (c === "exit") { os.close(); return; }
      if (c === "in" || (mode === "out" && e.target.closest(".gm-panel"))) { e.stopPropagation(); goIn(); }
    }, true);
    game.audio.sfx("whoosh"); goOut(true);
  }
  $("#gm-act").addEventListener("click", () => { if (near) use(near); });
  game.input.on("action", () => { if (game.scenes.name === "room" && near && !busy && !game.ui.modalOpen) use(near); });
  let pending = null;
  game.input.on("tap", (p) => {
    if (busy || game.ui.modalOpen || game.scenes.name !== "room") return;
    const r = canvas.getBoundingClientRect();
    const hit = scene.pick(((p.x + 1) / 2) * r.width, ((1 - p.y) / 2) * r.height, pickable, false, camera);
    if (!hit?.hit) return;
    const th = hit.pickedMesh.metadata?.thing;
    if (th) { pending = th; player.walkTo(th.at); }
    else { pending = null; player.walkTo({ x: hit.pickedPoint.x, z: hit.pickedPoint.z }); }
    hideHelp();
  });
  player.onArrive = () => { if (pending) { const th = pending; pending = null; use(th); } };
  const hideHelp = () => { if (helpGone) return; helpGone = true; $("#gm-help").classList.add("gone"); };

  // camera: a three-quarter follow camera that keeps the whole room readable
  const camT = new Vector3(), camP = new Vector3();
  let camX = null, camLastX = null, camLead = 0; // portrait follow state (dead zone + walking lead)
  const frame = () => { camera.fov = (aspect() < 0.8 ? 58 : 46) * Math.PI / 180; engine.resize(); };
  const onWinResize = () => frame(); addEventListener("resize", onWinResize);
  const goalCam = () => {
    const asp = aspect(), portrait = asp < 0.8, halfH = Math.atan(Math.tan(camera.fov / 2) * asp);
    // portrait: frame ~1.5 m either side of the follow point (not the whole room width, which left ~60% of a tall
    // screen as empty void above/below the room)
    const dist = portrait ? Math.min(11, Math.max(5.5, 1.5 / Math.tan(halfH))) : 7.4, hgt = portrait ? dist * 1.32 : 6.0;
    let tx = Math.max(-1.6, Math.min(1.6, player.pos.x * 0.55));
    if (portrait) {
      // a tall screen can only show ~±2.2 m of the 8 m room without empty void, so compose instead of chasing:
      // rest centred on the room, move only when the player leaves a dead zone, lead a little toward where they are
      // walking (the desk, the door, the bed come into view before they arrive), and stop at the walls (no void).
      const hw = Math.tan(halfH) * Math.hypot(hgt - 0.7, dist * 0.8 + 0.5), lim = Math.max(0, W + 0.9 - hw), band = hw * 0.3;
      const dx = player.pos.x - (camLastX ?? player.pos.x); camLastX = player.pos.x;
      camLead += ((Math.abs(dx) > 0.002 ? Math.sign(dx) * 0.5 : 0) - camLead) * 0.04;
      const want = player.pos.x + camLead;
      camX = Math.max(-lim, Math.min(lim, Math.max(want - band, Math.min(want + band, camX ?? 0))));
      tx = camX;
    }
    const tz = Math.max(-1.4, Math.min(1.2, player.pos.z * 0.45));
    camT.set(tx, 0.7, tz - (portrait ? 0.5 : 0.4)); camP.set(tx * 0.9, hgt, tz + (portrait ? dist * 0.8 : dist));
  };
  frame(); goalCam(); camera.position.copyFrom(camP); look.copyFrom(camT);
  const first = params.arrival || !game.save.flag("intro.done");
  let intro = first ? { k: 0 } : null;
  if (first) { camera.position.set(0.2, 1.7, -1.6); look.set(0, 1.6, -30); }
  camera.setTarget(look);

  let saveT = 0, lastSaved = "";
  const savePos = () => { const p = { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), r: +player.heading.toFixed(2) }; const k = JSON.stringify(p); if (k !== lastSaved) { lastSaved = k; game.save.set({ pos: p, scene: "room" }); } };

  game.room = { use: (id) => { const th = things.find((x) => x.id === id); if (th) return use(th); }, player, door: () => doorK, engine: "babylon" }; // the game's own tests
  const onStationClose = () => { refreshBal(); game.host.api("GET", "/api/mjt/mining").then((m) => { mining = m; minedOnce(m); }).catch(() => { }); };
  game.bus.on("station-closed", onStationClose);

  await scene.whenReadyAsync();
  game.canvas.style.visibility = "hidden";

  return {
    scene: null, camera: null, engine: "babylon",
    async enter() {
      frame(); game.audio.music("room"); game.audio.ambient("room");
      if (first) {
        busy = true; game.input.setEnabled(false);
        card(tl(C.title), tl(C.name));
        setTimeout(async () => {
          intro.k = 0.0001; await wait(2600);
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
      player.update(dt, busy ? STILL : mv, 0, world);
      let best = null, bd = 1.25;
      for (const th of things) {
        const d = Math.hypot(th.at.x - player.pos.x, th.at.z - player.pos.z); if (d < bd) { bd = d; best = th; }
        th.m.position.y = th.mark.y + Math.sin(time * 2.2 + th.mark.x) * 0.06; th.m.rotation.y += dt * 1.6;
        th.h.material.alpha += (((th === best) ? 0.9 : 0) - th.h.material.alpha) * Math.min(1, dt * 8);
        th.m.scaling.setAll(th.goal && !done(th.id) ? 1 : 0.7);
      }
      if (best !== near) { near = best; if (!busy) { showAct(near); if (near) game.audio.sfx("hover"); } }
      if (busy && !$("#gm-act").hidden) showAct(null);
      goalCam();
      if (cine) {
        cine.k = cine.t0 ? Math.min(1, (performance.now() - cine.t0) / 1000 * cine.sp) : Math.min(1, cine.k + dt * (cine.sp || 1.2)); const e = cine.lf ? cine.k * cine.k * (3 - 2 * cine.k) : 1 - Math.pow(1 - cine.k, 3);
        Vector3.LerpToRef(cine.from, cine.to, e, camera.position);
        if (cine.lf) Vector3.LerpToRef(cine.lf, cine.look, e, look); else Vector3.LerpToRef(look, cine.look, Math.min(1, dt * 3), look);
        if (cine.k === 1 && cine.done) { const d = cine.done; cine.done = null; setTimeout(d, 0); }
      } else if (intro && intro.k > 0) {
        intro.k = Math.min(1, intro.k + dt * 0.45); const e = intro.k * intro.k * (3 - 2 * intro.k), a = Math.min(1, dt * (0.6 + e * 3));
        Vector3.LerpToRef(camera.position, camP, a, camera.position); Vector3.LerpToRef(look, camT, a, look);
      } else if (!intro) { Vector3.LerpToRef(camera.position, camP, Math.min(1, dt * 3), camera.position); Vector3.LerpToRef(look, camT, Math.min(1, dt * 4), look); }
      camera.setTarget(look);
      if (Math.floor(time * 4) !== Math.floor((time - dt) * 4)) scr.tick(time);
      if (Math.floor(time * 6) !== Math.floor((time - dt) * 6)) news.tick(time);
      glassM.setFloat("uTime", time); glassM.setVector3("uCam", camera.position);
      if (doorK !== doorGoal) {
        doorK = doorGoal > doorK ? Math.min(doorGoal, doorK + dt / 1.2) : Math.max(doorGoal, doorK - dt / 1.2);
        const e = doorK * doorK * (3 - 2 * doorK);
        door.position.z = doorZ - e * (DOOR.z1 - DOOR.z0 + 0.04); spillM.alpha = e * 0.95; spillLight.intensity = e * 4;
      }
      monGlow.intensity = 0.8 + Math.sin(time * 9) * 0.06 + (Math.random() < 0.02 ? -0.35 : 0);
      saveT += dt; if (saveT > 8) { saveT = 0; savePos(); }
      scene.render();
      if (osHook) osHook();
    },
    exit() { savePos(); game.save.flush(); },
    dispose() {
      game.room = null; game.bus.off("station-closed", onStationClose); game.input.clear();
      removeEventListener("resize", onWinResize);
      try { scene.dispose(); engine.dispose(); } catch (e) { console.warn(e); }
      canvas.remove(); game.canvas.style.visibility = "";
    }
  };
}
