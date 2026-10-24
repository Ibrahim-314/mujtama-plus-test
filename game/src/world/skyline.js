/* The Digital City skyline — fully procedural, nothing to download:
 *   buildings   one InstancedMesh; a shader draws lit windows, roof edges and neon bands in world space, with fog
 *   the Core    the MJT tower in the centre: gold bands, a spire, a rotating halo ring and a beam into the sky
 *   traffic     flying cars on circular lanes (head- and tail-lights that bloom into streaks)
 *   signs       glowing rooftop billboards that flicker
 *   motes       gold particles rising around the Core (the city "mining")
 *   sky, stars, ground grid, optional rain
 * buildSkyline({ quality, rain, radius }) → { group, update(dt, t), core } */
import {
  Group, InstancedMesh, BoxGeometry, ShaderMaterial, Object3D, Color, InstancedBufferAttribute, PlaneGeometry, Mesh,
  CylinderGeometry, TorusGeometry, MeshBasicMaterial, AdditiveBlending, BackSide, SphereGeometry, BufferGeometry,
  Float32BufferAttribute, Points, PointsMaterial, LineSegments, LineBasicMaterial, CanvasTexture, DoubleSide, ConeGeometry,
  SRGBColorSpace
} from "three";
import { PALETTE } from "../config.js";

const rand = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const hot = (hex, k) => new Color(hex).multiplyScalar(k);

const FOG = `uniform vec3 uFog; uniform float uFogD;
vec3 fogIt(vec3 c, vec3 w){ float d = length(w - cameraPosition); float f = 1.0 - exp(-uFogD*uFogD*d*d); return mix(c, uFog, clamp(f, 0.0, 1.0)); }`;

function buildingMaterial(fog, fogD) {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFog: { value: new Color(fog) }, uFogD: { value: fogD }, uBase: { value: new Color(0x0b0e1f) } },
    vertexShader: `attribute float aSeed; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vS; varying float vSeed; varying vec3 vTint;
      void main(){ mat4 m = modelMatrix * instanceMatrix; vec4 w = m * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(m) * normal);
        vL = position; vS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vSeed = aSeed;
        #ifdef USE_INSTANCING_COLOR
        vTint = instanceColor;
        #else
        vTint = vec3(0.2, 0.9, 1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uBase; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vS; varying float vSeed; varying vec3 vTint;
      ${FOG}
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){ vec3 n = normalize(vN); vec3 c = uBase; float y = vL.y * vS.y;
        if (abs(n.y) > 0.5) { vec2 e = abs(vL.xz) * 2.0; c = uBase * 0.7 + vTint * smoothstep(0.9, 1.0, max(e.x, e.y)) * 1.6; }
        else {
          vec2 uv = abs(n.x) > 0.5 ? vec2(vL.z * vS.z, y) : vec2(vL.x * vS.x, y);
          vec2 cell = vec2(1.15, 1.6); vec2 id = floor(uv / cell); vec2 f = fract(uv / cell);
          float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.24, f.y) * step(f.y, 0.76);
          float r = h(id + vSeed * 17.0 + step(0.5, abs(n.x)) * 31.0 + step(0.0, n.x + n.z) * 7.0);
          float band = step(0.5, h(vec2(id.y, vSeed)));        // whole floors lit together, like offices
          float lit = step(0.6 - band * 0.25, r) * step(0.8, y);
          lit *= 1.0 - step(0.992, h(id + floor(uTime * 0.7) + vSeed)); // a few windows switch off and on
          vec3 warm = vec3(1.0, 0.78, 0.5), wc = mix(warm, vTint, step(0.55, h(id * 1.7 + vSeed)));
          c += win * lit * wc * (1.1 + r * 1.6);
          c += win * (1.0 - lit) * vec3(0.015, 0.02, 0.05);
          c += vTint * smoothstep(1.2, 0.0, y) * 0.35;                       // street-level glow
          c += vTint * step(vS.y - 0.35, y) * 1.4;                            // neon crown band
          float edge = smoothstep(0.47, 0.5, abs(abs(n.x) > 0.5 ? vL.z : vL.x)); c += vTint * edge * 0.55; // vertical edge lines
        }
        c = fogIt(c, vW); gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}

function groundMaterial(fog, fogD) {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFog: { value: new Color(fog) }, uFogD: { value: fogD }, uBlock: { value: 20 } },
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `uniform float uTime; uniform float uBlock; varying vec3 vW; ${FOG}
      float line(float x, float w){ float d = abs(fract(x) - 0.5); return smoothstep(w, 0.0, 0.5 - d); }
      void main(){ vec2 p = vW.xz; vec3 c = vec3(0.012, 0.015, 0.04);
        float g = max(line(p.x / 2.0 + 0.5, 0.02), line(p.y / 2.0 + 0.5, 0.02)); c += vec3(0.05, 0.25, 0.4) * g * 0.35;
        float road = max(line(p.x / uBlock + 0.5, 0.08), line(p.y / uBlock + 0.5, 0.08));
        float pulse = 0.6 + 0.4 * sin(uTime * 1.5 - length(p) * 0.08);
        c += mix(vec3(0.18, 0.9, 1.0), vec3(1.0, 0.25, 0.7), step(0.5, fract(floor(p.x / uBlock) * 0.5))) * road * 0.9 * pulse;
        c += vec3(1.0, 0.75, 0.25) * smoothstep(26.0, 0.0, length(p)) * 0.18;  // the Core's glow on the plaza
        c = fogIt(c, vW); gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}

function skyDome(radius) {
  const m = new ShaderMaterial({
    side: BackSide, depthWrite: false, uniforms: { uTop: { value: new Color(PALETTE.night) }, uHor: { value: new Color(PALETTE.dusk) } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; varying vec3 vP;
      void main(){ float y = max(vP.y, 0.0); vec3 c = mix(uHor * 1.1, uTop, pow(y, 0.55)); c += vec3(0.5, 0.3, 0.05) * pow(1.0 - y, 8.0) * 0.25;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  return new Mesh(new SphereGeometry(radius, 32, 16), m);
}

function signTexture(r, accent) {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 64; const x = cv.getContext("2d");
  x.fillStyle = "#000"; x.fillRect(0, 0, 128, 64);
  x.strokeStyle = accent; x.lineWidth = 4; x.strokeRect(4, 4, 120, 56);
  x.fillStyle = accent; const k = Math.floor(r * 4);
  if (k === 0) { x.font = "bold 34px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("MJT", 64, 34); }
  else if (k === 1) for (let i = 0; i < 6; i++) x.fillRect(14 + i * 17, 50 - (8 + ((i * 37) % 30)), 11, 8 + ((i * 37) % 30));
  else if (k === 2) { x.beginPath(); x.arc(64, 32, 18, 0, Math.PI * 2); x.lineWidth = 6; x.stroke(); x.fillRect(40, 30, 48, 4); }
  else { x.font = "bold 28px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("◆ 24H ◆", 64, 34); }
  const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; return t;
}

/** @param {{ quality?: {skyline:number, particles:number}, rain?: boolean, radius?: number, seed?: number, fog?: number, fogD?: number, plaza?: boolean, keep?: (x: number, z: number) => boolean }} o */
export function buildSkyline(o = {}) {
  const q = o.quality || { skyline: 1, particles: 1 }, R = o.radius || 150, rnd = rand(o.seed || 7);
  const fogC = o.fog ?? PALETTE.fog, fogD = o.fogD ?? 0.0105;
  const group = new Group(); const anim = [];

  group.add(skyDome(900));

  // stars
  { const n = Math.floor(900 * q.particles), p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 0.85 + 0.12); p.set([Math.cos(th) * Math.sin(ph) * 800, Math.cos(ph) * 800, Math.sin(th) * Math.sin(ph) * 800], i * 3); }
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(p, 3));
    group.add(new Points(g, new PointsMaterial({ color: 0xb8c8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false, fog: false }))); }

  // ground
  const gm = groundMaterial(fogC, fogD); const ground = new Mesh(new PlaneGeometry(R * 6, R * 6), gm); ground.rotation.x = -Math.PI / 2; group.add(ground);
  anim.push((dt, t) => { gm.uniforms.uTime.value = t; });

  // buildings on a block grid with roads between them; taller towards the Core
  const B = 20, road = 6, cells = Math.ceil(R / B), tints = [PALETTE.cyan, PALETTE.magenta, PALETTE.violet, PALETTE.cyan, PALETTE.gold].map((h) => new Color(h));
  const list = [];
  for (let gx = -cells; gx <= cells; gx++) for (let gz = -cells; gz <= cells; gz++) {
    const cx = gx * B, cz = gz * B, d = Math.hypot(cx, cz);
    if (d > R || (o.plaza !== false && Math.abs(gx) <= 1 && Math.abs(gz) <= 1)) continue;
    if (o.keep && !o.keep(cx, cz)) continue; // v2.94: a scene can keep a lot clear (the street in front of the Core)
    if (rnd() > q.skyline) continue;
    const parts = rnd() < 0.5 ? 1 : rnd() < 0.6 ? 2 : 4, inner = B - road;
    for (let i = 0; i < parts; i++) {
      const w = parts === 1 ? inner * (0.6 + rnd() * 0.35) : inner / 2 * (0.7 + rnd() * 0.25), dd = parts === 1 ? inner * (0.6 + rnd() * 0.35) : inner / 2 * (0.7 + rnd() * 0.25);
      const ox = parts === 1 ? 0 : ((i % 2) - 0.5) * inner / 2, oz = parts === 4 ? (Math.floor(i / 2) - 0.5) * inner / 2 : parts === 2 ? 0 : 0;
      const tall = 1 + 3.2 * Math.exp(-d / 55);
      const h = (8 + rnd() * 22) * tall * (rnd() < 0.08 ? 1.8 : 1);
      list.push({ x: cx + ox, z: cz + oz, w, d: parts === 2 ? inner * (0.6 + rnd() * 0.3) : dd, h, tint: tints[Math.floor(rnd() * tints.length)], seed: rnd() * 100 });
    }
  }
  const box = new BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const bm = buildingMaterial(fogC, fogD);
  const inst = new InstancedMesh(box, bm, list.length); const dummy = new Object3D(); const seeds = new Float32Array(list.length);
  list.forEach((b, i) => { dummy.position.set(b.x, 0, b.z); dummy.scale.set(b.w, b.h, b.d); dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix); inst.setColorAt(i, b.tint); seeds[i] = b.seed; });
  box.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
  inst.frustumCulled = false; group.add(inst);
  anim.push((dt, t) => { bm.uniforms.uTime.value = t; });

  // the Core — the MJT tower
  const core = new Group(); group.add(core);
  { const body = new Mesh(new CylinderGeometry(5.2, 7.5, 96, 6, 1), new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFog: { value: new Color(fogC) }, uFogD: { value: fogD } },
      vertexShader: "varying vec3 vW; varying vec3 vP; void main(){ vP = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: `uniform float uTime; varying vec3 vW; varying vec3 vP; ${FOG}
        void main(){ float y = vP.y + 48.0; vec3 c = vec3(0.03, 0.025, 0.05);
          float bands = smoothstep(0.92, 1.0, fract(y / 8.0)); c += vec3(1.0, 0.7, 0.2) * bands * 3.0;
          float run = smoothstep(0.96, 1.0, fract(y / 40.0 - uTime * 0.25)); c += vec3(1.0, 0.85, 0.4) * run * 2.5;
          float ang = atan(vP.z, vP.x); float seams = smoothstep(0.97, 1.0, abs(cos(ang * 3.0))); c += vec3(1.0, 0.6, 0.15) * seams * 0.8;
          c = fogIt(c, vW); gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` }));
    body.position.y = 48; core.add(body);
    anim.push((dt, t) => { body.material.uniforms.uTime.value = t; });
    const spire = new Mesh(new ConeGeometry(2.4, 26, 6), new MeshBasicMaterial({ color: hot(PALETTE.gold, 2.2) })); spire.position.y = 109; core.add(spire);
    const halo = new Mesh(new TorusGeometry(15, 0.45, 8, 96), new MeshBasicMaterial({ color: hot(PALETTE.goldHot, 4) })); halo.position.y = 88; halo.rotation.x = Math.PI / 2.2; core.add(halo);
    const halo2 = new Mesh(new TorusGeometry(10.5, 0.25, 8, 72), new MeshBasicMaterial({ color: hot(PALETTE.cyan, 3) })); halo2.position.y = 70; halo2.rotation.x = Math.PI / 1.9; core.add(halo2);
    const beam = new Mesh(new CylinderGeometry(1.2, 3.5, 420, 16, 1, true), new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, uniforms: { uTime: { value: 0 } },
      vertexShader: "varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform float uTime; varying vec2 vU; void main(){ float a = pow(1.0 - vU.y, 1.6) * (0.55 + 0.25 * sin(uTime * 2.0 + vU.y * 20.0)); gl_FragColor = vec4(vec3(1.0, 0.75, 0.3) * a * 1.4, a); }"
    }));
    beam.position.y = 120 + 210; core.add(beam);
    anim.push((dt, t) => { halo.rotation.z += dt * 0.25; halo2.rotation.z -= dt * 0.4; halo.position.y = 88 + Math.sin(t * 0.8) * 1.2; beam.material.uniforms.uTime.value = t; });
    // plaza ring lights
    const ring = new Mesh(new TorusGeometry(24, 0.18, 6, 128), new MeshBasicMaterial({ color: hot(PALETTE.gold, 2.5) })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; core.add(ring);
  }

  // flying traffic on circular lanes
  { const n = Math.floor(160 * q.particles), lanes = [];
    for (let i = 0; i < n; i++) lanes.push({ r: 30 + rnd() * (R - 40), y: 12 + rnd() * 50, a: rnd() * Math.PI * 2, s: (0.08 + rnd() * 0.12) * (rnd() < 0.5 ? 1 : -1) });
    const car = new BoxGeometry(0.35, 0.18, 2.2);
    const tm = new InstancedMesh(car, new MeshBasicMaterial({ toneMapped: true }), n); tm.frustumCulled = false;
    const cw = hot(0xfff1d6, 4), cr = hot(PALETTE.red, 4);
    lanes.forEach((l, i) => tm.setColorAt(i, l.s > 0 ? cw : cr)); group.add(tm);
    const d = new Object3D();
    anim.push((dt) => { lanes.forEach((l, i) => { l.a += l.s * dt * (40 / l.r); d.position.set(Math.cos(l.a) * l.r, l.y, Math.sin(l.a) * l.r); d.rotation.set(0, -l.a + (l.s > 0 ? 0 : Math.PI), 0); d.updateMatrix(); tm.setMatrixAt(i, d.matrix); }); tm.instanceMatrix.needsUpdate = true; }); }

  // rooftop signs
  { const signs = [], accents = ["#ff3fb4", "#2fe6ff", "#ffc23d", "#8a5cff"];
    const tall = list.filter((b) => b.h > 25).sort(() => rnd() - 0.5).slice(0, Math.floor(26 * q.skyline));
    for (const b of tall) {
      const acc = accents[Math.floor(rnd() * accents.length)];
      const m = new MeshBasicMaterial({ map: signTexture(rnd(), acc), color: new Color(2.2, 2.2, 2.2), side: DoubleSide, transparent: true, blending: AdditiveBlending, depthWrite: false });
      const s = new Mesh(new PlaneGeometry(Math.min(b.w, 12), Math.min(b.w, 12) / 2), m);
      s.position.set(b.x, b.h + Math.min(b.w, 12) / 4 + 0.6, b.z); s.rotation.y = Math.atan2(-b.x, -b.z); group.add(s); signs.push({ m, k: rnd() });
    }
    anim.push((dt, t) => { for (const s of signs) { const f = Math.sin(t * (2 + s.k * 3) + s.k * 40) > 0.97 - s.k * 0.02 ? 0.25 : 2.2; s.m.color.setScalar(f); } }); }

  // gold motes rising around the Core
  { const n = Math.floor(500 * q.particles), p = new Float32Array(n * 3), sp = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, r = 8 + rnd() * 30; p.set([Math.cos(a) * r, rnd() * 110, Math.sin(a) * r], i * 3); sp[i] = 2 + rnd() * 6; }
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(p, 3));
    const pts = new Points(g, new PointsMaterial({ color: hot(PALETTE.goldHot, 2.5), size: 0.5, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }));
    group.add(pts);
    anim.push((dt) => { const a = g.attributes.position.array; for (let i = 0; i < n; i++) { a[i * 3 + 1] += sp[i] * dt; if (a[i * 3 + 1] > 120) a[i * 3 + 1] = 0; } g.attributes.position.needsUpdate = true; }); }

  // rain (title screen mood)
  if (o.rain && q.particles > 0.3) {
    const n = Math.floor(2200 * q.particles), p = new Float32Array(n * 6), v = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (rnd() - 0.5) * 160, y = rnd() * 80, z = (rnd() - 0.5) * 160; p.set([x, y, z, x - 0.15, y - 1.4, z], i * 6); v[i] = 45 + rnd() * 25; }
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(p, 3));
    const rain = new LineSegments(g, new LineBasicMaterial({ color: 0x7fb6ff, transparent: true, opacity: 0.28, depthWrite: false }));
    group.add(rain);
    anim.push((dt) => { const a = g.attributes.position.array; for (let i = 0; i < n; i++) { const dy = v[i] * dt; a[i * 6 + 1] -= dy; a[i * 6 + 4] -= dy; if (a[i * 6 + 4] < 0) { a[i * 6 + 1] += 80; a[i * 6 + 4] += 80; } } g.attributes.position.needsUpdate = true; });
  }

  return { group, core, update: (dt, t) => { for (const f of anim) f(dt, t); }, buildings: list };
}
