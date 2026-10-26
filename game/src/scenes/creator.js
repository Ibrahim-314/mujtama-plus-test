/* Character creation: a dark studio with a holographic pedestal inside a neon portal ring. The chosen character
 * materialises in a scan beam; swipe or drag to turn them, arrows to switch, then the name they will carry in the city. */
import {
  Scene, PerspectiveCamera, Color, Fog, HemisphereLight, SpotLight, PointLight, Mesh, CylinderGeometry, MeshStandardMaterial,
  TorusGeometry, MeshBasicMaterial, CircleGeometry, ShaderMaterial, AdditiveBlending, DoubleSide, BufferGeometry,
  Float32BufferAttribute, Points, PointsMaterial, Group, PlaneGeometry
} from "three";
import { CHARS, PALETTE } from "../config.js";
import { t, tl } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";
import { loadCharacter } from "../world/player.js";

const NAME_RE = /^[\p{L}\p{N}_ ]{2,20}$/u;
export const STORY_RESET = { "intro.done": false, "room.window": false, "room.computer": false, "room.door": false, "room.boxes": false, "room.bed": false, "room.done": false };

export async function create(game, params = {}) {
  const scene = new Scene(); scene.background = new Color(0x04051a); scene.fog = new Fog(0x04051a, 8, 26);
  const camera = new PerspectiveCamera(38, 1, 0.1, 100);
  scene.add(new HemisphereLight(0x4a5cff, 0x080812, 0.55));
  const key = new SpotLight(0xffe2b0, 40, 14, Math.PI / 7, 0.5, 1.6); key.position.set(1.8, 5.5, 3.5); key.target.position.set(0, 1, 0); scene.add(key, key.target);
  const rim = new PointLight(PALETTE.cyan, 18, 7, 1.8); rim.position.set(-1.6, 2.2, -1.6); scene.add(rim);
  const rim2 = new PointLight(PALETTE.magenta, 12, 7, 1.8); rim2.position.set(1.8, 1.6, -1.4); scene.add(rim2);

  // floor + pedestal
  const floor = new Mesh(new CircleGeometry(14, 64), new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform float uTime; varying vec2 vP; void main(){ float r = length(vP); vec3 c = vec3(0.01, 0.012, 0.035);
      float rings = smoothstep(0.03, 0.0, abs(fract(r * 1.2 - uTime * 0.15) - 0.5) - 0.47); c += vec3(0.1, 0.6, 0.9) * rings * smoothstep(9.0, 1.5, r) * 0.6;
      float ang = atan(vP.y, vP.x); float spokes = smoothstep(0.02, 0.0, abs(fract(ang / 6.2831 * 24.0) - 0.5) - 0.48); c += vec3(0.1, 0.4, 0.7) * spokes * smoothstep(7.0, 2.0, r) * 0.25;
      c *= smoothstep(14.0, 4.0, r); gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const ped = new Mesh(new CylinderGeometry(1.05, 1.2, 0.22, 64), new MeshStandardMaterial({ color: 0x141828, metalness: 0.85, roughness: 0.3 })); ped.position.y = 0.11; scene.add(ped);
  const pedRing = new Mesh(new TorusGeometry(1.08, 0.025, 8, 96), new MeshBasicMaterial({ color: new Color(PALETTE.cyan).multiplyScalar(3) })); pedRing.rotation.x = Math.PI / 2; pedRing.position.y = 0.225; scene.add(pedRing);
  const disc = new Mesh(new CircleGeometry(1.0, 64), new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uTime: { value: 0 }, uC: { value: new Color(PALETTE.cyan) } },
    vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform float uTime; uniform vec3 uC; varying vec2 vP; void main(){ float r = length(vP); float a = atan(vP.y, vP.x); float k = smoothstep(0.05, 0.0, abs(fract(r * 5.0 - uTime * 0.6) - 0.5) - 0.44) * 0.6 + smoothstep(0.98, 1.0, r) * 1.5; k += smoothstep(0.03, 0.0, abs(fract((a + uTime * 0.5) / 6.2831 * 3.0) - 0.5) - 0.47) * smoothstep(0.3, 0.9, r) * 0.5; gl_FragColor = vec4(uC * k * 1.6, k); }"
  }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.226; scene.add(disc);
  // the neon portal behind
  const portal = new Group(); portal.position.set(0, 1.6, -2.6); scene.add(portal);
  const ringA = new Mesh(new TorusGeometry(2.3, 0.04, 8, 128), new MeshBasicMaterial({ color: new Color(PALETTE.magenta).multiplyScalar(3) }));
  const ringB = new Mesh(new TorusGeometry(2.55, 0.015, 8, 128), new MeshBasicMaterial({ color: new Color(PALETTE.cyan).multiplyScalar(2.5) }));
  const ringC = new Mesh(new TorusGeometry(2.05, 0.012, 8, 128, Math.PI * 1.2), new MeshBasicMaterial({ color: new Color(PALETTE.gold).multiplyScalar(3) }));
  portal.add(ringA, ringB, ringC);
  const veil = new Mesh(new CircleGeometry(2.3, 64), new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uTime: { value: 0 } },
    vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform float uTime; varying vec2 vP; void main(){ float r = length(vP) / 2.3; float s = sin(vP.y * 18.0 + uTime * 2.0) * 0.5 + 0.5; float k = pow(r, 3.0) * 0.35 + s * 0.03; gl_FragColor = vec4(vec3(0.6, 0.2, 1.0) * k, k); }" }));
  portal.add(veil);
  // the scan beam that materialises a character
  const beam = new Mesh(new CylinderGeometry(0.75, 0.95, 2.4, 48, 1, true), new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, uniforms: { uK: { value: 0 }, uTime: { value: 0 }, uC: { value: new Color(PALETTE.cyan) } },
    vertexShader: "varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform float uK; uniform float uTime; uniform vec3 uC; varying vec2 vU; void main(){ float lines = step(0.5, fract(vU.y * 40.0 - uTime * 3.0)); float a = uK * (0.25 + lines * 0.25) * (1.0 - vU.y * 0.6); gl_FragColor = vec4(uC * a * 2.0, a); }" }));
  beam.position.y = 1.4; scene.add(beam);
  // motes
  const n = Math.floor(260 * game.renderer.q.particles), p = new Float32Array(n * 3), sp = new Float32Array(n);
  for (let i = 0; i < n; i++) { p.set([(Math.random() - 0.5) * 10, Math.random() * 5, (Math.random() - 0.5) * 8 - 1], i * 3); sp[i] = 0.1 + Math.random() * 0.35; }
  const mg = new BufferGeometry(); mg.setAttribute("position", new Float32BufferAttribute(p, 3));
  scene.add(new Points(mg, new PointsMaterial({ color: new Color(PALETTE.goldHot).multiplyScalar(2), size: 0.035, transparent: true, opacity: 0.8, depthWrite: false, blending: AdditiveBlending })));
  const back = new Mesh(new PlaneGeometry(40, 20), new MeshBasicMaterial({ color: 0x04051a })); back.position.set(0, 5, -9); scene.add(back);

  // ---- state + UI ----
  const prev = game.save.data;
  let idx = Math.max(0, CHARS.findIndex((c) => c.id === (params.fresh ? null : prev?.char))), cur = null, spin = 0.5, drag = null, beamK = 0, token = 0;
  const me = game.host.me?.() || {};
  const firstName = String(me.name || "").trim().split(/\s+/)[0] || "";
  const suggested = (!params.fresh && prev?.name) || (NAME_RE.test(firstName) ? firstName : "");
  const L = game.ui.layer(`
    <header class="gm-ctop"><span class="gm-step">${esc(t("الفصل 0 · الوصول", "Chapter 0 · Arrival"))}</span><h2>${esc(t("من أنت في المدينة؟", "Who are you in the city?"))}</h2></header>
    <section class="gm-cpanel">
      <div class="gm-crow">
        <button type="button" class="gm-arrow" data-d="-1" aria-label="${esc(t("السابق", "Previous"))}">${icon("back")}</button>
        <div class="gm-cinfo" aria-live="polite"><b id="gm-cname"></b><span id="gm-ctag"></span><div class="gm-dots" id="gm-dots">${CHARS.map(() => "<i></i>").join("")}</div></div>
        <button type="button" class="gm-arrow fwd" data-d="1" aria-label="${esc(t("التالي", "Next"))}">${icon("back")}</button>
      </div>
      <label class="gm-field"><span>${esc(t("اسمك في المدينة", "Your name in the city"))}</span>
        <input id="gm-nm" type="text" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(suggested)}" placeholder="${esc(t("مثلاً: نور", "e.g. Noor"))}" aria-describedby="gm-nm-h"></label>
      <p class="gm-hint" id="gm-nm-h">${esc(t("من 2 إلى 20 حرفاً — يظهر لكل من تقابله في المدينة.", "2–20 letters — everyone you meet in the city will see it."))}</p>
      <button type="button" class="gm-btn wide hero" id="gm-go" data-sfx="confirm">${icon("play")}<span>${esc(t("ادخل المدينة", "Enter the city"))}</span></button>
    </section>`, "gm-creator");
  const $ = (s) => L.querySelector(s);
  const paint = () => {
    const c = CHARS[idx]; $("#gm-cname").textContent = tl({ ar: c.ar, en: c.en }); $("#gm-ctag").textContent = tl({ ar: c.tagAr, en: c.tagEn });
    L.style.setProperty("--acc", c.accent); [...$("#gm-dots").children].forEach((d, i) => d.classList.toggle("on", i === idx));
    beam.material.uniforms.uC.value.set(c.accent); disc.material.uniforms.uC.value.set(c.accent);
  };
  async function show(i) {
    idx = (i + CHARS.length) % CHARS.length; paint(); const my = ++token;
    beamK = 1; game.audio.sfx("scan");
    if (cur) { const old = cur; cur = null; old.leaving = 1; leaving.push(old); }
    try {
      const ch = await loadCharacter(CHARS[idx].id, 1.72);
      if (my !== token) return;
      ch.model.position.y += 0.225; ch.model.rotation.y = spin; ch.model.scale.multiplyScalar(0.001); ch.base = ch.model.scale.x * 1000; ch.grow = 0;
      ch.idle.play(); scene.add(ch.model); cur = ch;
    } catch { game.ui.toast(t("تعذّر تحميل الشخصية", "Could not load the character"), "bad"); }
  }
  const leaving = [];
  L.addEventListener("click", (e) => { const d = e.target.closest("[data-d]"); if (d) show(idx + Number(d.dataset.d)); });
  const nm = $("#gm-nm");
  $("#gm-go").addEventListener("click", async () => {
    const name = nm.value.replace(/\s+/g, " ").trim();
    if (!NAME_RE.test(name)) { nm.classList.add("bad"); nm.focus(); game.ui.toast(t("اختر اسماً من 2 إلى 20 حرفاً (حروف وأرقام فقط)", "Pick a 2–20 character name (letters and digits only)"), "bad"); return; }
    $("#gm-go").disabled = true;
    game.save.set({ char: CHARS[idx].id, name, scene: "room", pos: null, flags: params.fresh || !prev ? STORY_RESET : {} });
    await game.save.flush();
    if (cur) cur.acts.Cheer && (cur.acts.Cheer.reset().play(), cur.idle.crossFadeTo(cur.acts.Cheer, 0.2, false));
    // Season 1 opens with the prologue («الإشارة»), which hands over to the room exactly as the creator used to
    setTimeout(() => game.scenes.go("prologue", { fade: 700, next: "room", nextParams: { arrival: true, fade: 700 } }), 900);
  });
  nm.addEventListener("input", () => nm.classList.remove("bad"));
  // drag to turn the character
  const surf = game.surface;
  const pd = (e) => { if (e.target.closest(".gm-cpanel")) return; drag = { x: e.clientX, s: spin }; }, pm = (e) => { if (drag) spin = drag.s + (e.clientX - drag.x) * 0.012; }, pu = () => { drag = null; };
  surf.addEventListener("pointerdown", pd); addEventListener("pointermove", pm); addEventListener("pointerup", pu);
  const kd = (e) => { if (e.target === nm) return; if (e.key === "ArrowLeft") show(idx + (L.closest("[dir=rtl]") ? 1 : -1)); if (e.key === "ArrowRight") show(idx + (L.closest("[dir=rtl]") ? -1 : 1)); };
  addEventListener("keydown", kd);
  paint(); show(idx);

  const frame = () => {
    const a = camera.aspect, portrait = a < 0.8;
    camera.position.set(0, portrait ? 1.75 : 1.5, portrait ? 6.2 : 4.4); camera.lookAt(0, portrait ? 0.55 : 1.0, 0); camera.fov = portrait ? 44 : 36; camera.updateProjectionMatrix();
  };
  game.renderer.onResize = frame;

  return {
    scene, camera, bloom: { strength: 0.9, radius: 0.5, threshold: 0.8 },
    enter() { frame(); game.audio.music("creator"); game.audio.ambient(null); },
    update(dt, time) {
      if (!drag) spin += dt * 0.35;
      if (cur) { cur.model.rotation.y = spin; cur.mixer.update(dt); if (cur.grow < 1) { cur.grow = Math.min(1, cur.grow + dt * 2.2); const k = 1 - Math.pow(1 - cur.grow, 3); cur.model.scale.setScalar(cur.base * k); } }
      for (let i = leaving.length - 1; i >= 0; i--) { const o = leaving[i]; o.leaving -= dt * 4; o.model.scale.multiplyScalar(Math.max(0.01, 1 - dt * 6)); o.model.rotation.y += dt * 8; if (o.leaving <= 0) { scene.remove(o.model); leaving.splice(i, 1); } }
      beamK = Math.max(0, beamK - dt * 0.9); beam.material.uniforms.uK.value = beamK; beam.material.uniforms.uTime.value = time;
      disc.material.uniforms.uTime.value = time; floor.material.uniforms.uTime.value = time; veil.material.uniforms.uTime.value = time;
      ringA.rotation.z += dt * 0.2; ringB.rotation.z -= dt * 0.12; ringC.rotation.z += dt * 0.5; pedRing.material.color.setScalar(2 + Math.sin(time * 3) * 0.6).multiply(new Color(PALETTE.cyan));
      const arr = mg.attributes.position.array; for (let i = 0; i < n; i++) { arr[i * 3 + 1] += sp[i] * dt; if (arr[i * 3 + 1] > 5) arr[i * 3 + 1] = 0; } mg.attributes.position.needsUpdate = true;
    },
    dispose() { game.renderer.onResize = null; surf.removeEventListener("pointerdown", pd); removeEventListener("pointermove", pm); removeEventListener("pointerup", pu); removeEventListener("keydown", kd); }
  };
}
