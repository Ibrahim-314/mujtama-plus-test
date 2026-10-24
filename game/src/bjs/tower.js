/* The MJT tower — «برج مجتمع كوين», the hero of the street (v2.97 visual pass): a twisting curtain-wall tower of 26
 * floors (three floor meshes with different lit-window patterns, instanced), polished gold slabs and corner fins on every
 * floor, a glass crown with a gold ring and spire, and the MJT coin in real gold turning at the top. Its entrance faces
 * the street: a glass lobby, a stone canopy with a gold fascia on two gold columns, a gold portal round breathing glass
 * doors and the MJT sign standing on the canopy. Gold is PBR metal (it takes the sunset and the sky), with only a little
 * emission so the glow layer gives it a soft edge instead of flattening it. */
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { textTexture } from "./core.js";

const rnd = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** polished gold: a metal that reflects the environment, warmed by a touch of its own light */
export function goldMat(scene, name = "gold", glow = 0.32, rough = 0.26) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.FromHexString("#ffcf6e"); m.metallic = 1; m.roughness = rough;
  m.emissiveColor = Color3.FromHexString("#ff9d1e").scale(glow); m.environmentIntensity = 1.25;
  return m;
}

/** a curtain wall: bronze mullions, a dark spandrel band at each slab, glass bays — some lit warm from inside */
function curtain(scene, seed, litShare, bays = 8) {
  const R = rnd(seed);
  const alb = textTexture(scene, 512, 256, (x, w, h) => {
    x.fillStyle = "#0e1a30"; x.fillRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(120,150,210,.18)"); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = "#17141c"; x.fillRect(0, h * 0.84, w, h * 0.16);              // spandrel
    x.fillStyle = "#3a3022"; for (let i = 0; i <= bays; i++) x.fillRect(i * (w / bays) - 3, 0, 6, h); // mullions
    x.fillRect(0, h * 0.84 - 3, w, 4);
  }, false);
  const emi = textTexture(scene, 512, 256, (x, w, h) => {
    x.fillStyle = "#000"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < bays; i++) {
      const r = R(); if (r > litShare) continue;
      const warm = r < litShare * 0.75, a = 0.35 + R() * 0.45;
      const gr = x.createLinearGradient(0, 0, 0, h * 0.84);
      gr.addColorStop(0, warm ? `rgba(255,205,140,${a})` : `rgba(140,200,255,${a * 0.7})`); gr.addColorStop(1, warm ? `rgba(255,170,90,${a * 0.6})` : `rgba(90,150,255,${a * 0.4})`);
      x.fillStyle = gr; x.fillRect(i * (w / bays) + 4, 4, w / bays - 8, h * 0.84 - 8);
    }
  }, false);
  const m = new PBRMaterial("curtain" + seed, scene);
  m.albedoTexture = alb; m.emissiveTexture = emi; m.emissiveColor = new Color3(1, 1, 1);
  m.metallic = 0.6; m.roughness = 0.1; m.environmentIntensity = 1.1;
  return m;
}

export function buildTower(scene, { z, gateZ, low }) {
  const root = new TransformNode("mjt-tower", scene); root.position.set(0, 0, z);
  const casters = [], statics = [], colliders = [];
  const FLOORS = low ? 20 : 26, FH = 3.3, W = 11;

  // ---------- the shaft: floors turning a little each, narrowing towards the top ----------
  const gold = goldMat(scene, "towerGold");
  const kinds = [curtain(scene, 7, 0.45), curtain(scene, 19, 0.3), curtain(scene, 41, 0.6)].map((mat, i) => {
    const b = CreateBox("towerFloor" + i, { width: W, depth: W, height: FH * 0.86 }, scene); b.material = mat; b.parent = root; return b;
  });
  const slab0 = CreateBox("towerSlab", { width: W + 0.5, depth: W + 0.5, height: 0.24 }, scene); slab0.material = gold; slab0.parent = root;
  const fin0 = CreateBox("towerFin", { width: 0.32, depth: 0.32, height: FH * 0.86 }, scene); fin0.material = gold; fin0.parent = root;
  const used = new Set();
  for (let i = 0; i < FLOORS; i++) {
    const k = 1 - (i / FLOORS) * 0.32, a = i * 0.045, h = i ? FH : 5.4, y = 0.14 + (i ? 5.4 + (i - 1) * FH : 0);
    const src = i === 0 ? kinds[2] : kinds[(i * 7) % 3];
    const f = used.has(src) ? src.createInstance("tf" + i) : src; used.add(src); f.parent = root;
    f.position.set(0, y + h * 0.45, 0); f.rotation.y = a; f.scaling.set(k, h / FH, k);
    const s = i === 0 ? slab0 : slab0.createInstance("ts" + i); s.parent = root;
    s.position.set(0, y + h * 0.93, 0); s.rotation.y = a; s.scaling.set(k, 1, k);
    statics.push(f, s);
    if (!low || i % 2 === 0) for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const fn = (i === 0 && cx === 1 && cz === 1) ? fin0 : fin0.createInstance("fin"); fn.parent = f;
      fn.position.set(cx * (W / 2 + 0.06), 0, cz * (W / 2 + 0.06)); fn.scaling.set(1 / k, 1, 1 / k); statics.push(fn);
    }
  }
  casters.push(...kinds, slab0);
  const topY = 0.14 + 5.4 + (FLOORS - 1) * FH, topK = 1 - 0.32, topA = FLOORS * 0.045;

  // ---------- the crown: a glass lantern, a gold ring, the spire ----------
  const crownGlass = new PBRMaterial("crownGlass", scene); crownGlass.albedoColor = Color3.FromHexString("#1a2440"); crownGlass.metallic = 0.7; crownGlass.roughness = 0.06;
  crownGlass.emissiveColor = Color3.FromHexString("#ffb347").scale(0.35); crownGlass.environmentIntensity = 1.3;
  const lantern = CreateCylinder("lantern", { diameterTop: W * topK * 0.55, diameterBottom: W * topK * 1.05, height: 3.2, tessellation: 4 }, scene);
  lantern.material = crownGlass; lantern.parent = root; lantern.position.y = topY + 1.6; lantern.rotation.y = topA + Math.PI / 4;
  const crown = CreateTorus("crown", { diameter: W * topK * 1.28, thickness: 0.32, tessellation: 64 }, scene); crown.material = gold; crown.parent = root; crown.position.y = topY + 0.4;
  const crown2 = CreateTorus("crown2", { diameter: W * topK * 0.62, thickness: 0.2, tessellation: 48 }, scene); crown2.material = gold; crown2.parent = root; crown2.position.y = topY + 3.25;
  const spire = CreateCylinder("spire", { diameterTop: 0.06, diameterBottom: 0.5, height: 11, tessellation: 12 }, scene); spire.material = gold; spire.parent = root; spire.position.y = topY + 8.6;
  statics.push(lantern, crown, crown2, spire);

  // ---------- the coin: struck gold, the MJT mark in relief, a reeded rim ----------
  const coinTex = textTexture(scene, 512, 512, (x, w, h) => {
    const c = w / 2;
    const g = x.createRadialGradient(c * 0.8, c * 0.7, 10, c, c, c); g.addColorStop(0, "#fff0c0"); g.addColorStop(0.6, "#ffcc5a"); g.addColorStop(1, "#c88a1e");
    x.fillStyle = g; x.beginPath(); x.arc(c, c, c, 0, 7); x.fill();
    for (let i = 0; i < 120; i++) { const a = (i / 120) * Math.PI * 2; x.strokeStyle = i % 2 ? "rgba(120,70,0,.35)" : "rgba(255,240,190,.4)"; x.lineWidth = 3; x.beginPath(); x.moveTo(c + Math.cos(a) * (c - 6), c + Math.sin(a) * (c - 6)); x.lineTo(c + Math.cos(a) * (c - 26), c + Math.sin(a) * (c - 26)); x.stroke(); }
    x.lineWidth = 10; x.strokeStyle = "#9a6210"; x.beginPath(); x.arc(c, c, c - 44, 0, 7); x.stroke();
    x.lineWidth = 3; x.strokeStyle = "rgba(255,245,200,.8)"; x.beginPath(); x.arc(c, c, c - 50, 0, 7); x.stroke();
    x.textAlign = "center"; x.textBaseline = "middle"; x.font = "900 168px sans-serif";
    x.fillStyle = "rgba(255,248,215,.9)"; x.fillText("MJT", c - 4, c + 2);   // the relief's lit edge
    x.fillStyle = "#7a4a06"; x.fillText("MJT", c + 4, c + 10);              // its shadow
    x.fillStyle = "#e9a73a"; x.fillText("MJT", c, c + 6);
    x.font = "700 30px sans-serif"; x.fillStyle = "#8a5408"; x.fillText("MUJTAMA COIN", c, c + 118);
  }, false, true);
  const coinM = new PBRMaterial("coinFace", scene); coinM.albedoTexture = coinTex; coinM.metallic = 1; coinM.roughness = 0.22;
  coinM.emissiveTexture = coinTex; coinM.emissiveColor = new Color3(0.42, 0.34, 0.22); coinM.environmentIntensity = 1.3;
  const coin = new TransformNode("coin", scene); coin.parent = root; coin.position.y = topY + 10.4;
  const edge = CreateCylinder("coinEdge", { diameter: 7, height: 0.6, tessellation: 72 }, scene); edge.material = goldMat(scene, "coinEdge", 0.25, 0.32); edge.parent = coin; edge.rotation.x = Math.PI / 2;
  const rim = CreateTorus("coinRim", { diameter: 6.95, thickness: 0.34, tessellation: 72 }, scene); rim.material = gold; rim.parent = coin; rim.rotation.x = Math.PI / 2;
  for (const s of [1, -1]) { const p = CreatePlane("coinFace", { size: 6.9 }, scene); p.material = coinM; p.parent = coin; p.position.z = s * 0.31; p.rotation.y = s > 0 ? Math.PI : 0; } // a plane faces -z until turned (seen from +z only when turned round)
  casters.push(edge);

  // ---------- the podium and the plaza ----------
  const stone = new PBRMaterial("podium", scene); stone.albedoColor = Color3.FromHexString("#2a2632"); stone.metallic = 0.1; stone.roughness = 0.32; stone.environmentIntensity = 0.8;
  const podium = CreateCylinder("podium", { diameter: 30, height: 0.14, tessellation: 96 }, scene); podium.material = stone; podium.parent = root; podium.position.y = 0.07; podium.receiveShadows = true;
  const trim = CreateTorus("trim", { diameter: 30.1, thickness: 0.14, tessellation: 128 }, scene); trim.material = gold; trim.parent = root; trim.position.y = 0.14;
  const inlay = CreateTorus("inlay", { diameter: 22, thickness: 0.06, tessellation: 128 }, scene); inlay.material = gold; inlay.parent = root; inlay.position.y = 0.14; inlay.scaling.y = 0.2;
  statics.push(podium, trim, inlay);

  // ---------- the entrance ----------
  const face = z + W / 2;                         // the shaft's street face
  const lobbyDepth = Math.max(1, gateZ - face);
  const lobbyM = curtain(scene, 77, 0.95, 6); lobbyM.emissiveColor = new Color3(0.62, 0.56, 0.5);
  const lobby = CreateBox("lobby", { width: 9, height: 5.2, depth: lobbyDepth }, scene);
  lobby.material = lobbyM; lobby.position.set(0, 2.6 + 0.14, face + lobbyDepth / 2 - 0.05); statics.push(lobby); casters.push(lobby);
  const gate = new TransformNode("gate", scene); gate.position.set(0, 0.14, gateZ);
  // the canopy: dark stone, a gold fascia, two gold columns at the front
  const canopy = CreateBox("canopy", { width: 10.4, height: 0.42, depth: 3.4 }, scene); canopy.material = stone; canopy.parent = gate; canopy.position.set(0, 5.45, 1.5); statics.push(canopy); casters.push(canopy);
  const fascia = CreateBox("fascia", { width: 10.5, height: 0.14, depth: 0.08 }, scene); fascia.material = gold; fascia.parent = gate; fascia.position.set(0, 5.45, 3.22); statics.push(fascia);
  const under = CreateBox("canopyUnder", { width: 9.6, height: 0.02, depth: 2.8 }, scene);
  const underM = new StandardMaterial("canopyUnder", scene); underM.emissiveColor = Color3.FromHexString("#ffd9a0").scale(0.55); underM.diffuseColor = Color3.Black(); underM.disableLighting = true;
  under.material = underM; under.parent = gate; under.position.set(0, 5.23, 1.5); statics.push(under);
  for (const s of [-1, 1]) {
    const c = CreateCylinder("column", { diameter: 0.42, height: 5.25, tessellation: 24 }, scene); c.material = gold; c.parent = gate; c.position.set(s * 4.6, 2.62, 2.9); statics.push(c); casters.push(c);
    const base = CreateCylinder("colBase", { diameter: 0.7, height: 0.18, tessellation: 24 }, scene); base.material = stone; base.parent = gate; base.position.set(s * 4.6, 0.09, 2.9); statics.push(base);
    colliders.push({ min: { x: s * 4.6 - 0.4, z: gateZ + 2.5 }, max: { x: s * 4.6 + 0.4, z: gateZ + 3.3 } });
  }
  // the portal round the doors
  const portal = [[0.34, 4.9, -2.3, 2.45], [0.34, 4.9, 2.3, 2.45], [4.94, 0.34, 0, 4.9]];
  for (const [w, h, x, y] of portal) { const p = CreateBox("portal", { width: w, height: h, depth: 0.5 }, scene); p.material = gold; p.parent = gate; p.position.set(x, y, 0.2); statics.push(p); }
  const doorM = new StandardMaterial("door", scene); doorM.emissiveColor = Color3.FromHexString("#2fe6ff").scale(0.35); doorM.diffuseColor = Color3.Black(); doorM.alpha = 0.5; doorM.disableLighting = true;
  // a dark reveal inside the portal and a stone threshold give the doors depth
  const reveal = CreateBox("reveal", { width: 4.5, height: 4.85, depth: 0.12 }, scene); const revM = new PBRMaterial("reveal", scene); revM.albedoColor = Color3.FromHexString("#0b0b10"); revM.metallic = 0.6; revM.roughness = 0.2;
  reveal.material = revM; reveal.parent = gate; reveal.position.set(0, 2.43, -0.02); statics.push(reveal);
  const sill = CreateBox("sill", { width: 5.4, height: 0.08, depth: 1.1 }, scene); sill.material = stone; sill.parent = gate; sill.position.set(0, 0.04, 0.5); statics.push(sill);
  const door = CreatePlane("door", { width: 4.2, height: 4.7 }, scene); door.material = doorM; door.parent = gate; door.position.set(0, 2.38, 0.08); door.rotation.y = Math.PI;
  const mull = CreateBox("doorMullion", { width: 0.08, height: 4.7, depth: 0.06 }, scene); mull.material = gold; mull.parent = gate; mull.position.set(0, 2.38, 0.12); statics.push(mull);
  for (const s of [-1, 1]) { const hb = CreateBox("handle", { width: 0.05, height: 1.1, depth: 0.08 }, scene); hb.material = gold; hb.parent = gate; hb.position.set(s * 0.22, 1.25, 0.18); statics.push(hb); }
  // the sign stands on the canopy
  // three lines, nothing overlapping: MJT large, the Arabic name, MUJTAMA COIN small (tall canvas: Arabic dots never clip)
  const signTex = textTexture(scene, 1024, 320, (x, w) => {
    x.textAlign = "center"; x.textBaseline = "alphabetic";
    x.shadowColor = "#ffb02e"; x.shadowBlur = 22; x.fillStyle = "#ffe39a"; x.font = "900 128px sans-serif"; x.fillText("MJT", w / 2, 128);
    x.shadowBlur = 0; x.fillStyle = "#ffc23d"; x.fillRect(w / 2 - 180, 150, 360, 3);
    x.fillStyle = "#fff3d6"; x.font = "700 56px sans-serif"; x.direction = "rtl"; x.fillText("برج مجتمع كوين", w / 2, 222);
    x.direction = "ltr"; x.fillStyle = "#ffd77a"; x.font = "700 34px sans-serif"; x.fillText("M U J T A M A   C O I N", w / 2, 290);
  }, true, true);
  const signM = new StandardMaterial("signM", scene); signM.emissiveTexture = signTex; signM.opacityTexture = signTex; signM.disableLighting = true; signM.diffuseColor = Color3.Black();
  // a black glass plate with a thin gold border behind the letters, so they read against the bright lobby and the sky
  const plate = CreateBox("signPlate", { width: 6.9, height: 2.25, depth: 0.12 }, scene); plate.material = revM; plate.parent = gate; plate.position.set(0, 6.9, 2.46); statics.push(plate);
  const pb = CreateBox("signBorder", { width: 7.05, height: 2.4, depth: 0.08 }, scene); pb.material = gold; pb.parent = gate; pb.position.set(0, 6.9, 2.41); statics.push(pb);
  const sign = CreatePlane("sign", { width: 6.4, height: 2 }, scene); sign.material = signM; sign.parent = gate; sign.position.set(0, 6.9, 2.53); sign.rotation.y = Math.PI;
  for (const m of [...statics, door, sign, mull]) m.isPickable = false;

  let t = 0;
  const cyan = Color3.FromHexString("#2fe6ff");
  return {
    root, casters, colliders, glass: kinds[0].material, gold, doorM, topY,
    lookAt: new Vector3(0, topY * 0.55, z),
    update(dt, glow) {
      t += dt; coin.rotation.y += dt * 0.7;
      doorM.emissiveColor.copyFrom(cyan.scale(0.32 + Math.sin(t * 2) * 0.08 + glow * 2.2));
    }
  };
}
