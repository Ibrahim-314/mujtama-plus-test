/* Babylon.js for «المدينة الرقمية» (v2.97): the street runs on Babylon's engine — PBR materials lit by an HDR environment,
 * real-time shadows, a glow layer for every lamp and sign, filmic tone mapping and FXAA — on its own canvas over the
 * three.js one (the room keeps three.js). Only the pieces of Babylon the street uses are imported (deep imports keep the
 * chunk small), and the whole module loads only when the player first steps out of the door.
 * Pi Browser shows apps in the phone's system WebView (Chromium on Android, WebKit on iOS): WebGL2 everywhere, so the
 * engine runs on WebGL2 (WebGL1 as Babylon's own fallback). */
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import "@babylonjs/core/Materials/Textures/Loaders/envTextureLoader.js";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js";
import "@babylonjs/core/Layers/effectLayerSceneComponent.js";
import "@babylonjs/core/Culling/ray.js";
import "@babylonjs/core/Animations/animatable.js";
import "@babylonjs/core/Rendering/depthRendererSceneComponent.js";
import "@babylonjs/loaders/glTF/2.0/index.js";

export { Engine, Scene, Color3, Color4, Vector3, DynamicTexture, Texture, StandardMaterial, PBRMaterial };

/** A Babylon engine on a canvas of its own, layered over the game's three.js canvas inside the stage. */
export function makeEngine(stage, q) {
  const canvas = document.createElement("canvas");
  canvas.className = "gm-canvas gm-bjs"; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;touch-action:none"; stage.appendChild(canvas);
  const engine = new Engine(canvas, q.bloom, { stencil: true, preserveDrawingBuffer: false, powerPreference: "high-performance", antialias: q.bloom, audioEngine: false, doNotHandleContextLost: false }, false);
  engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio || 1, q.dpr > 2 ? 2 : q.dpr));
  engine.disableManifestCheck = true; engine.enableOfflineSupport = false;
  return { canvas, engine };
}

/** A cache of loaded glTF files per scene: load once, instance many times. */
export class Models {
  constructor(scene) { this.scene = scene; this.c = new Map(); }
  get(url) {
    if (!this.c.has(url)) this.c.set(url, LoadAssetContainerAsync(url, this.scene).then((ct) => { this.prep(ct); return ct; }));
    return this.c.get(url);
  }
  /** a static model: its source meshes go into the scene far below the ground (instances render through them) */
  getStatic(url) {
    const k = "s:" + url;
    if (!this.c.has(k)) this.c.set(k, this.get(url).then((ct) => { ct.addAllToScene(); for (const n of ct.rootNodes) n.position.y = -5000; for (const m of ct.meshes) m.isPickable = false; return ct; }));
    return this.c.get(k);
  }
  /** Kenney kits share one palette texture: crisp (no mip blur on the colour swatches), slightly rough */
  prep(ct) {
    for (const m of ct.materials) {
      if (m.albedoTexture) { m.albedoTexture.updateSamplingMode(Texture.NEAREST_LINEAR_MIPLINEAR); m.albedoTexture.anisotropicFilteringLevel = 4; }
      if (m.metallic == null || m.metallic > 0.5) m.metallic = 0.05;
      m.roughness = Math.min(m.roughness ?? 0.7, 0.72);
      m.environmentIntensity = 0.9;
    }
  }
  /** tint every instance of one model (each model file has its own materials): breaks up a street of repeats */
  async tint(url, hex, rough, metal) {
    const ct = await this.getStatic(url);
    for (const m of ct.materials) { m.albedoColor = Color3.FromHexString(hex); if (rough != null) m.roughness = rough; if (metal != null) m.metallic = metal; }
  }
  /** Place an instance of a model: {x, y, z, ry, s} (s = uniform scale). Returns the root node. */
  async put(url, o = {}) {
    const ct = await (o.clone ? this.get(url) : this.getStatic(url));
    const e = ct.instantiateModelsToScene((n) => n, false, { doNotInstantiate: !!o.clone });
    const r = e.rootNodes[0];
    r.position.set(o.x || 0, o.y || 0, o.z || 0);
    r.rotationQuaternion = null; r.rotation.set(0, o.ry || 0, 0);
    const s = o.s || 1; r.scaling.set(o.sx || s, o.sy || s, o.sz || s);
    for (const m of r.getChildMeshes(false)) m.isPickable = false;
    return { root: r, entries: e };
  }
}

/** A canvas texture for signs (Arabic shaped by the browser's own text layout). */
export function textTexture(scene, w, h, draw, alpha = true, mirror = false) {
  const t = new DynamicTexture("sign", { width: w, height: h }, scene, true);
  t.hasAlpha = alpha; const x = t.getContext(); x.clearRect(0, 0, w, h);
  // the scene is right-handed (glTF's own), so a plane turned to face the street shows its texture mirrored: draw it
  // mirrored once here and it reads the right way round on screen
  if (mirror) x.setTransform(-1, 0, 0, 1, w, 0);
  draw(x, w, h); t.update(true); return t;
}

/** A flat, unlit, glowing material (lamps, neon, the gold of the tower). */
export function glowMat(scene, hex, k = 1, name = "glow") {
  const m = new StandardMaterial(name, scene); const c = Color3.FromHexString(hex).scale(k);
  m.emissiveColor = c; m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); m.disableLighting = true; return m;
}
