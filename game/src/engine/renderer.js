/* The renderer: WebGL2 through three.js, ACES filmic tone mapping, and a post-processing chain
 * (render → bloom → output) that makes every emissive surface glow like neon. Three quality tiers (config.QUALITY);
 * "auto" picks one from the device and steps down by itself when the frame rate stays low. */
import { WebGLRenderer, SRGBColorSpace, ACESFilmicToneMapping, PCFSoftShadowMap, Vector2, HalfFloatType } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { QUALITY } from "../config.js";

export function detectQuality() {
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  const touch = matchMedia("(pointer: coarse)").matches;
  if (mem <= 2 || cores <= 2) return "low";
  if (touch && (mem <= 4 || cores <= 4)) return "medium";
  return touch ? "medium" : "high";
}

export class Renderer {
  /** @param {HTMLCanvasElement} canvas @param {string} quality auto|low|medium|high */
  constructor(canvas, quality = "auto") {
    this.canvas = canvas;
    this.gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    this.scene = null; this.camera = null; this.composer = null; this.bloom = null;
    this.bloomCfg = { strength: 0.85, radius: 0.55, threshold: 0.78 };
    this.mode = quality; this.tier = quality === "auto" ? detectQuality() : quality;
    this._slow = 0;
    this._resize = () => this.resize();
    addEventListener("resize", this._resize);
    this.apply();
  }
  get q() { return QUALITY[this.tier]; }
  setQuality(mode) { this.mode = mode; this.tier = mode === "auto" ? detectQuality() : mode; this.apply(); }
  apply() {
    this.gl.shadowMap.enabled = this.q.shadows;
    this.gl.setPixelRatio(Math.min(devicePixelRatio || 1, this.q.dpr));
    this.build(); this.resize();
  }
  setBloom(cfg) { Object.assign(this.bloomCfg, cfg); if (this.bloom) Object.assign(this.bloom, cfg); }
  setScene(scene, camera) { this.scene = scene; this.camera = camera; this.build(); this.resize(); }
  build() {
    this.composer?.dispose(); this.composer = null; this.bloom = null;
    if (!this.scene || !this.q.bloom) return;
    const c = new EffectComposer(this.gl); c.renderTarget1.texture.type = HalfFloatType; c.renderTarget2.texture.type = HalfFloatType;
    c.addPass(new RenderPass(this.scene, this.camera));
    const s = this.size();
    this.bloom = new UnrealBloomPass(new Vector2(s.w / 2, s.h / 2), this.bloomCfg.strength, this.bloomCfg.radius, this.bloomCfg.threshold);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.composer = c;
  }
  size() { const r = this.canvas.parentElement?.getBoundingClientRect(); return { w: Math.max(1, Math.round(r?.width || innerWidth)), h: Math.max(1, Math.round(r?.height || innerHeight)) }; }
  resize() {
    const { w, h } = this.size();
    this.gl.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(this.gl.getPixelRatio()); this.composer.setSize(w, h); }
    if (this.camera) { if (this.camera.isPerspectiveCamera) { this.camera.aspect = w / h; } this.camera.updateProjectionMatrix(); }
    this.onResize?.(w, h);
  }
  /** Called every frame. In auto mode a frame rate under 32 for ~4 s steps the tier down once at a time. */
  render(fps) {
    if (!this.scene || !this.camera) return;
    if (this.composer) this.composer.render(); else this.gl.render(this.scene, this.camera);
    if (this.mode === "auto" && fps) {
      this._slow = fps < 32 ? this._slow + 1 : Math.max(0, this._slow - 1);
      if (this._slow > 240) { this._slow = 0; const down = { high: "medium", medium: "low" }[this.tier]; if (down) { this.tier = down; this.apply(); } }
    }
  }
  dispose() { removeEventListener("resize", this._resize); this.composer?.dispose(); this.gl.dispose(); this.gl.forceContextLoss?.(); }
}
