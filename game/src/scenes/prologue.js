/* The prologue — «مجتمع — الموسم الأول: الإشارة». A real-time Babylon.js cinematic (~86 s) played once, after the
 * character creator and before the apartment: the mountain village at dawn → the father's old device wakes → Yousuf's
 * message → the mother and the brass key «40» → the magnetic train → the Digital City and its golden tower → the signal
 * on the train's display → the title. Skippable at any moment (button or Esc).
 *
 * How it is put together (each part in its own file):
 *   scenes/prologue-shots.js  the camera shots and the timed events (data)
 *   story/prologue.js         the subtitles and the title (words)
 *   bjs/prologue-sets.js      the five places, built from code + the game's own character models
 *   bjs/cinema.js             the sequencer (Phase 2A) that moves the camera and times the subtitles
 *
 * Rendering: Babylon draws into the game's existing canvas, on the WebGL context three.js already holds (Babylon's
 * documented "existing context" mode), so the cinematic opens no second WebGL context. The three.js renderer is idle
 * meanwhile (this scene hands it no scene), and its state is reset when the prologue is disposed.
 * Nothing is saved: the selected character is only read, and the next scene (the room, with its arrival intro) starts
 * exactly as the creator used to start it. If Babylon cannot start, the prologue steps straight to the next scene. */
import { Engine, Scene, Color3, Color4, Vector3, Models, StandardMaterial } from "../bjs/core.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer.js";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Sequence } from "../bjs/cinema.js";
import { buildVillage, buildHome, buildTrain, buildCity, buildCabin, skyTexture } from "../bjs/prologue-sets.js";
import { SET_ORIGIN, SHOTS, EVENTS, DURATION, shotStarts, worldShots } from "./prologue-shots.js";
import { PROLOGUE as P } from "../story/prologue.js";
import { charUrl } from "../world/player.js";
import { ASSET, CHARS } from "../config.js";
import { tl, getLang } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";

/** One way out, used by both the end and skip: wait for the scene manager to be free, then go on. */
function goNextOnce(game, next, nextParams) {
  let sent = false;
  return () => { if (sent) return; sent = true; const go = () => (game.scenes.busy ? setTimeout(go, 60) : game.scenes.go(next, nextParams)); go(); };
}

export async function create(game, params = {}) {
  const next = params.next || "room", nextParams = params.nextParams || { arrival: true, fade: 700 };
  const goNext = goNextOnce(game, next, nextParams);
  try { return await createBabylon(game, params, goNext); } catch (e) {
    console.error("[prologue] could not start, going on", e);
    return { scene: null, camera: null, engine: "none", enter() { goNext(); }, update() { }, dispose() { } };
  }
}

async function createBabylon(game, params, goNext) {
  const save = game.save.data || {};
  const tier = game.renderer.tier, low = tier === "low", high = tier === "high";
  const gl = game.renderer.gl.getContext();
  if (!gl) throw new Error("no gl");
  // Babylon on the context three.js already holds: one canvas, one WebGL context
  const engine = new Engine(gl, false, { audioEngine: false, preserveDrawingBuffer: false, stencil: true, doNotHandleContextLost: true }, false);
  const dpr = Math.min(devicePixelRatio || 1, low ? 1.25 : high ? 2 : 1.6);
  engine.setHardwareScalingLevel(1 / dpr);
  engine.disableManifestCheck = true; engine.enableOfflineSupport = false;
  const canvas = game.renderer.gl.domElement;
  const resize = () => { engine.resize(); };
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true; scene.detachControl?.();
  scene.skipPointerMovePicking = true; scene.skipPointerDownPicking = true; scene.skipPointerUpPicking = true;
  scene.fogMode = Scene.FOGMODE_EXP2;
  const env = CubeTexture.CreateFromPrefilteredData(ASSET("city/sky.env"), scene); scene.environmentTexture = env;
  const models = new Models(scene);

  // the sets, each at its own origin (the hero is the chosen character; the mother is a different model)
  const heroId = save.char || "hoodie";
  const momId = heroId === "casual-f" ? "suit-f" : "casual-f";
  const ctx = { low, high, models, heroUrl: charUrl(CHARS.find((c) => c.id === heroId) ? heroId : "hoodie"), momUrl: charUrl(momId) };
  const [village, home, train, city, cabin] = await Promise.all([
    buildVillage(scene, SET_ORIGIN.village, ctx), buildHome(scene, SET_ORIGIN.home, ctx), buildTrain(scene, SET_ORIGIN.train, ctx),
    buildCity(scene, SET_ORIGIN.city, ctx), buildCabin(scene, SET_ORIGIN.cabin, ctx)
  ]);
  const sets = { village, home, train, city, cabin };

  // one sky dome around the camera; its gradient changes with the set
  const skyM = new StandardMaterial("pSkyM", scene); skyM.disableLighting = true; skyM.backFaceCulling = false; skyM.fogEnabled = false; skyM.diffuseColor = Color3.Black(); skyM.specularColor = Color3.Black();
  const sky = CreateSphere("pSky", { diameter: 5000, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene); sky.material = skyM; sky.infiniteDistance = true; sky.applyFog = false; sky.isPickable = false;
  const skyTex = {}; for (const k in sets) if (sets[k].look.sky) skyTex[k] = skyTexture(scene, sets[k].look.sky);
  skyM.emissiveTexture = skyTex.village;

  // camera and the image: filmic tone mapping, a gentle vignette, glow on lamps and gold; bloom and depth of field on high
  const camera = new FreeCamera("pCam", new Vector3(...SET_ORIGIN.village), scene); camera.inputs.clear(); camera.minZ = 0.02; camera.maxZ = 6000;
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES; ip.vignetteEnabled = true; ip.vignetteWeight = 2.2; ip.vignetteColor = new Color4(0, 0, 0, 0); ip.vignetteStretch = 0.4;
  let glow = null, pipe = null;
  if (!low) {
    glow = new GlowLayer("pGlow", scene, { mainTextureRatio: high ? 0.5 : 0.33, blurKernelSize: high ? 40 : 28 });
    glow.addExcludedMesh(sky);
    pipe = new DefaultRenderingPipeline("pPost", true, scene, [camera]);
    pipe.fxaaEnabled = true; pipe.samples = high ? 4 : 1; pipe.imageProcessingEnabled = true;
    pipe.bloomEnabled = high; pipe.bloomThreshold = 0.82; pipe.bloomWeight = 0.22; pipe.bloomKernel = 64; pipe.bloomScale = 0.5;
    pipe.grainEnabled = high; if (high) { pipe.grain.intensity = 6; pipe.grain.animated = true; }
  }
  const frameFov = () => { const a = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()); camera.fov = (a < 0.8 ? 64 : 44) * Math.PI / 180; };
  const onResize = () => { resize(); frameFov(); }; addEventListener("resize", onResize);

  // ---- which set is on screen ----
  let cur = null, dofOn = false;
  const show = (name) => {
    if (cur === name) return; cur = name;
    for (const k in sets) sets[k].root.setEnabled(k === name);
    const L = sets[name].look;
    scene.clearColor = Color4.FromHexString(L.clear + "ff"); scene.fogColor = Color3.FromHexString(L.fog); scene.fogDensity = L.fogDensity;
    scene.environmentIntensity = L.env; ip.exposure = L.exposure; ip.contrast = L.contrast; if (glow) glow.intensity = L.glow;
    sky.setEnabled(!!L.sky); if (L.sky) skyM.emissiveTexture = skyTex[name];
    if (home.dust) { if (name === "home") home.dust.start(); else home.dust.stop(); }
  };
  const setDof = (target) => {
    if (!pipe || !high) return;
    if (!target) { if (dofOn) { pipe.depthOfFieldEnabled = false; dofOn = false; } return; }
    if (!dofOn) { pipe.depthOfFieldEnabled = true; pipe.depthOfFieldBlurLevel = 1; dofOn = true; }
    pipe.depthOfField.focalLength = 50; pipe.depthOfField.fStop = 1.8; pipe.depthOfField._target = target;
  };

  // compile every set's shaders up front (all sets on, one frame each), so a cut never stalls
  for (const k in sets) sets[k].root.setEnabled(true);
  await scene.whenReadyAsync();
  show("village");

  // ---- the interface: letterbox, subtitles, the title, a black dip for cuts, the skip button ----
  const lang = getLang();
  const L = game.ui.layer(`
    <div class="gm-cine" id="gm-cine" dir="${lang === "ar" ? "rtl" : "ltr"}">
      <div class="gm-cine-bar top"></div><div class="gm-cine-bar bot"></div>
      <div class="gm-cine-dip" id="gm-cine-dip"></div>
      <div class="gm-cine-sub" id="gm-cine-sub" aria-live="polite" hidden><b class="who"></b><p class="line"></p></div>
      <div class="gm-cine-title" id="gm-cine-title" hidden><b dir="rtl" lang="ar">${esc(P.title.ar)}</b>${lang === "ar" ? "" : `<small dir="ltr" lang="en">${esc(P.title.en)}</small>`}</div>
      <button type="button" class="gm-btn gm-cine-skip" id="gm-cine-skip" data-sfx="back">${icon("play")}<span>${esc(tl(P.skip))}</span></button>
    </div>`, "gm-cine-layer");
  const $ = (s) => L.querySelector(s);
  const subEl = $("#gm-cine-sub"), dipEl = $("#gm-cine-dip"), titleEl = $("#gm-cine-title");
  game.input.setEnabled(false);

  const starts = shotStarts();
  const cutTimes = SHOTS.map((s, i) => (s.cut && i > 0 ? starts[i] : null)).filter((x) => x != null);
  const dipAt = (tt) => {
    let a = Math.max(0, 1 - tt / 1.8); // from black at the start
    for (const c of cutTimes) { if (tt > c - 0.3 && tt <= c) a = Math.max(a, (tt - (c - 0.3)) / 0.3); else if (tt > c && tt < c + 0.45) a = Math.max(a, 1 - (tt - c) / 0.45); }
    if (tt > DURATION - 0.9) a = Math.max(a, (tt - (DURATION - 0.9)) / 0.9); // to black at the end
    return Math.min(1, a);
  };

  // ---- the sequencer ----
  let done = false;
  const finish = () => { if (done) return; done = true; L.classList.add("out"); game.audio.sfx("whoosh", { down: true }); goNext(); };
  const shots = worldShots();
  // the key close-up frames the key where the mother's hand actually holds it (her pose decides the exact spot)
  const keyAt = home.prepareOffer(), KI = SHOTS.findIndex((s) => s.data?.dof);
  if (KI >= 0) {
    // a two-shot from where the protagonist stands: the key in her hand, her face above it, then a slow push to the key
    const head = home.momHead(), mix = (k) => Vector3.Lerp(keyAt, head, k), arr = (v) => [v.x, v.y, v.z];
    const sh = shots[KI];
    sh.from = { pos: arr(keyAt.add(new Vector3(-0.42, 0.36, 1.05))), look: arr(mix(0.42)) };
    sh.to = { pos: arr(keyAt.add(new Vector3(-0.2, 0.16, 0.5))), look: arr(mix(0.12)) };
    sh.data.dof = arr(keyAt);
  }
  // the device's screen shows, in Arabic, the line Yousuf is saying
  const yLines = P.subtitles.filter((x) => x.who?.ar?.startsWith("يوسف"));
  const seq = new Sequence({
    camera, makeVec: (x, y, z) => new Vector3(x, y, z), shots, subtitles: P.subtitles, lang: getLang,
    onShot: (i, s) => {
      show(s.data.set);
      setDof(s.data.dof ? new Vector3(...s.data.dof) : null);
      if (s.data.set === "home") { home.heroFace(...(i >= 5 ? [3, 1] : [0.1, -1.3])); home.hero.root.setEnabled(i !== KI); }
      if (i === KI) home.offerKey();
    },
    onSubtitle: (l) => {
      if (!l) { subEl.classList.remove("on"); return; }
      subEl.dir = l.dir; subEl.lang = l.dir === "rtl" ? "ar" : "en";
      subEl.querySelector(".who").textContent = l.who || ""; subEl.querySelector(".who").hidden = !l.who; subEl.querySelector(".line").textContent = l.text;
      subEl.hidden = false; subEl.classList.remove("on"); void subEl.offsetWidth; subEl.classList.add("on");
    },
    onComplete: () => finish()
  });
  const skip = () => { if (!done) seq.skip(); };
  $("#gm-cine-skip").addEventListener("click", skip);
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); skip(); } };
  addEventListener("keydown", onKey, true);

  const fired = new Set();
  const fire = (ev) => {
    switch (ev) {
      case "device-on": home.deviceOn(); game.audio.sfx("scan"); break;
      case "message": home.message(true); game.audio.sfx("ping"); break;
      case "message-end": home.message(false); break;
      case "train": game.audio.sfx("whoosh"); break;
      case "lights-fail": cabin.lightsFail(); game.audio.sfx("locked"); break;
      case "signal": cabin.signal(); game.audio.sfx("scan"); break;
      case "title": titleEl.hidden = false; requestAnimationFrame(() => titleEl.classList.add("on")); game.audio.sfx("reveal"); break;
    }
  };

  // the game's own tests: the sequencer, the sets, a fast-forward
  game.prologue = { seq, sets, engine, skip, forward: (s) => { let r = s; while (r > 0 && !seq.finished) { const d = Math.min(0.25, r); seq.update(d); r -= d; } }, shareContext: engine._gl === gl };

  frameFov();
  return {
    scene: null, camera: null, engine: "babylon",
    enter() { game.audio.music(null); game.audio.ambient("room"); resize(); frameFov(); seq.start(); },
    update(dt, time) {
      if (canvas.width !== Math.round(canvas.clientWidth * dpr) && canvas.clientWidth) resize();
      seq.update(dt);
      const st = seq.time;
      for (const e of EVENTS) if (!fired.has(e.ev) && st >= e.at) { fired.add(e.ev); if (!done) fire(e.ev); }
      const yl = yLines.find((x) => st >= x.at - 0.2 && st < x.at + x.dur + 0.4); home.screenLine(yl ? yl.text.ar : "");
      dipEl.style.setProperty("--a", dipAt(st).toFixed(3));
      if (dofOn && pipe?.depthOfField?._target) pipe.depthOfField.focusDistance = Vector3.Distance(camera.position, pipe.depthOfField._target) * 1000;
      if (cur) sets[cur].update?.(dt, time);
      scene.render();
    },
    exit() { },
    dispose() {
      seq.dispose(); game.prologue = null;
      removeEventListener("resize", onResize); removeEventListener("keydown", onKey, true);
      try { scene.dispose(); engine.dispose(); } catch (e) { console.warn("[prologue] dispose", e); }
      try { game.renderer.gl.resetState(); game.renderer.resize(); } catch { /* the three.js renderer re-syncs on its next scene */ }
      game.input.setEnabled(true);
    }
  };
}
