/* Street life for the boulevard (v2.95): the buildings that line the pavements, the trees in their planters, and the
 * people walking up and down beside the kerb.
 * Kept light for phones: every facade shares one of three canvas textures (each building's UVs are scaled instead of
 * cloning textures), shop fronts share six signs, trees are instanced, and the walkers are tiny procedural figures made of
 * a few shared geometries — no skinned models, no extra lights. Low tier: fewer walkers, no chatting groups. */
import {
  Group, Mesh, BoxGeometry, PlaneGeometry, CylinderGeometry, SphereGeometry, IcosahedronGeometry, ConeGeometry,
  MeshBasicMaterial, MeshStandardMaterial, CanvasTexture, SRGBColorSpace, InstancedMesh, Object3D, Color, Box3, Vector3,
  AdditiveBlending, RepeatWrapping
} from "three";

const rnd = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/* ---------- textures ---------- */
function canvas(w, h, draw) { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d"), w, h); const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping; t.anisotropy = 4; return t; }
/** one tile = 2 window columns × 3 floors; tiled over each facade by its UVs */
function facadeTex(kind, r) {
  return canvas(256, 384, (x, w, h) => {
    const base = { glass: "#101a33", stone: "#3a3046", hijazi: "#4a3a33" }[kind];
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let f = 0; f < 3; f++) for (let c = 0; c < 2; c++) {
      const X = c * 128, Y = f * 128, k = r();
      if (kind === "glass") {
        x.fillStyle = k < 0.3 ? "#16233f" : k < 0.75 ? "#7fd0ff" : "#ffd59a"; x.globalAlpha = k < 0.3 ? 1 : 0.45 + r() * 0.4;
        x.fillRect(X + 6, Y + 8, 116, 108); x.globalAlpha = 1; x.fillStyle = "rgba(255,255,255,.08)"; x.fillRect(X + 6, Y + 8, 116, 10);
        x.fillStyle = "#0b1226"; x.fillRect(X + 62, Y + 8, 4, 108);
      } else if (kind === "stone") {
        x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(X + 22, Y + 22, 84, 88);
        x.fillStyle = k < 0.3 ? "#241c2e" : k < 0.8 ? "#ffcf8a" : "#9fdcff"; x.globalAlpha = k < 0.3 ? 1 : 0.6 + r() * 0.4;
        x.fillRect(X + 28, Y + 28, 72, 76); x.globalAlpha = 1; x.fillStyle = "#2a2234"; x.fillRect(X + 62, Y + 28, 4, 76); x.fillRect(X + 28, Y + 62, 72, 4);
        x.fillStyle = "#4d4258"; x.fillRect(X + 18, Y + 106, 92, 8);
      } else { // Hijazi: carved wooden rawashin bays with lattice, warm light behind
        x.fillStyle = "#e9dcc4"; x.fillRect(X, Y, 128, 128); x.fillStyle = "rgba(0,0,0,.08)"; for (let i = 0; i < 6; i++) x.fillRect(X, Y + i * 22, 128, 2);
        x.fillStyle = "#6b3f22"; x.fillRect(X + 20, Y + 16, 88, 100);
        x.fillStyle = k < 0.35 ? "#2b1a10" : "#ffc77a"; x.globalAlpha = k < 0.35 ? 1 : 0.55 + r() * 0.35; x.fillRect(X + 28, Y + 26, 72, 70); x.globalAlpha = 1;
        x.strokeStyle = "#5a321a"; x.lineWidth = 3; for (let i = 0; i <= 72; i += 9) { x.beginPath(); x.moveTo(X + 28 + i, Y + 26); x.lineTo(X + 28 + i, Y + 96); x.stroke(); x.beginPath(); x.moveTo(X + 28, Y + 26 + i * 70 / 72); x.lineTo(X + 100, Y + 26 + i * 70 / 72); x.stroke(); }
        x.fillStyle = "#4e2c16"; x.fillRect(X + 16, Y + 100, 96, 16); x.fillRect(X + 16, Y + 10, 96, 8);
      }
    }
  });
}
const SHOPS = [
  { ar: "مقهى", en: "CAFÉ", c: "#ffb35c", bg: "#2a1a10" }, { ar: "مخبز", en: "BAKERY", c: "#ffd76a", bg: "#2b2010" },
  { ar: "بقالة", en: "MARKET", c: "#3dffb0", bg: "#0f2a20" }, { ar: "صيدلية", en: "PHARMACY", c: "#5ef08a", bg: "#0d2416" },
  { ar: "عطور", en: "OUD", c: "#ff7ad0", bg: "#2a1028" }, { ar: "مكتبة", en: "BOOKS", c: "#7fd0ff", bg: "#0f1d33" }
];
/** the ground floor: lit shop window, door and a glowing Arabic sign */
function shopTex(s) {
  return canvas(512, 256, (x, w, h) => {
    x.fillStyle = "#14121d"; x.fillRect(0, 0, w, h);
    x.fillStyle = s.bg; x.fillRect(0, 0, w, 70);
    x.textAlign = "center"; x.textBaseline = "middle"; x.shadowColor = s.c; x.shadowBlur = 16; x.fillStyle = s.c;
    x.font = "bold 44px sans-serif"; x.direction = "rtl"; x.fillText(s.ar, w * 0.62, 36); x.direction = "ltr"; x.font = "bold 22px sans-serif"; x.fillText(s.en, w * 0.24, 38); x.shadowBlur = 0;
    const g = x.createLinearGradient(0, 84, 0, h); g.addColorStop(0, "#fff0cf"); g.addColorStop(1, "#ffb76b");
    x.fillStyle = g; x.globalAlpha = 0.85; x.fillRect(18, 86, 300, 150); x.globalAlpha = 1;
    x.fillStyle = "rgba(60,30,10,.55)"; for (let i = 0; i < 5; i++) x.fillRect(34 + i * 58, 170 + (i % 2) * 14, 36, 66 - (i % 2) * 14); // shelves / goods silhouettes
    x.fillStyle = "#1c1826"; x.fillRect(18, 150, 300, 4); x.fillRect(166, 86, 4, 150);
    x.fillStyle = "#ffe2b0"; x.globalAlpha = 0.7; x.fillRect(352, 96, 120, 160); x.globalAlpha = 1; x.fillStyle = "#14121d"; x.fillRect(410, 96, 4, 160); // glass door
  });
}

/* ---------- people ---------- */
const SKIN = [0xc68a5e, 0xa86f48, 0xe0b08a, 0x8a5a3a];
const KINDS = ["thobe", "thobe", "abaya", "casual", "casual", "sport"];
const CASUAL = [0x2f6fd6, 0xd63a5a, 0x2fb383, 0xf0a030, 0x7a5cff, 0xe8e8f0];
const PANTS = [0x23263a, 0x3a4a6a, 0x5a4a3a];
function makePeople() {
  const G = {
    leg: new BoxGeometry(0.13, 0.82, 0.15).translate(0, -0.41, 0), arm: new BoxGeometry(0.1, 0.62, 0.11).translate(0, -0.31, 0),
    torso: new BoxGeometry(0.42, 0.62, 0.24), robe: new CylinderGeometry(0.2, 0.3, 1.32, 8).translate(0, -0.66, 0),
    head: new SphereGeometry(0.13, 10, 8), scarf: new ConeGeometry(0.2, 0.36, 8, 1, true).translate(0, -0.06, 0),
    hood: new SphereGeometry(0.155, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), foot: new BoxGeometry(0.12, 0.08, 0.22).translate(0, -0.04, 0.04),
    ring: new CylinderGeometry(0.15, 0.15, 0.04, 10, 1, true)
  };
  const mats = new Map(), M = (hex) => { if (!mats.has(hex)) mats.set(hex, new MeshStandardMaterial({ color: hex, roughness: 0.75 })); return mats.get(hex); };
  /** a figure ~1.7 m tall; returns { obj, step(phase, speed) } */
  function person(r) {
    const kind = KINDS[Math.floor(r() * KINDS.length)], skin = M(SKIN[Math.floor(r() * SKIN.length)]);
    const obj = new Group(), body = new Group(); obj.add(body);
    const sc = 0.92 + r() * 0.14; obj.scale.setScalar(sc);
    const head = new Mesh(G.head, skin); head.position.y = 1.58; body.add(head);
    const L = [], A = [];
    const limbs = (legM, armM, footM) => {
      for (const s of [-1, 1]) {
        const lg = new Mesh(legM ? G.leg : G.foot, legM || footM); lg.position.set(s * 0.1, legM ? 0.84 : 0.08, 0); body.add(lg); L.push(lg);
        const ar = new Mesh(G.arm, armM); ar.position.set(s * 0.27, 1.38, 0); body.add(ar); A.push(ar);
      }
    };
    if (kind === "thobe" || kind === "abaya") {
      const dark = kind === "abaya", robeM = M(dark ? 0x121218 : 0xf2f0ea);
      const robe = new Mesh(G.robe, robeM); robe.position.y = 1.44; body.add(robe);
      const top = new Mesh(G.torso, robeM); top.scale.set(0.95, 0.5, 1); top.position.y = 1.32; body.add(top);
      limbs(null, robeM, M(dark ? 0x1a1a22 : 0x3a2a20));
      if (dark) { const h = new Mesh(G.hood, M(0x0e0e14)); h.position.y = 1.6; h.scale.set(1.05, 1.1, 1.05); body.add(h); }
      else {
        const red = r() < 0.55, sh = new Mesh(G.scarf, M(red ? 0xc8303a : 0xf7f7f2)); sh.position.y = 1.66; body.add(sh);
        const cap = new Mesh(G.hood, M(red ? 0xc8303a : 0xf7f7f2)); cap.position.y = 1.62; cap.scale.setScalar(1.02); body.add(cap);
        const agal = new Mesh(G.ring, M(0x111114)); agal.position.y = 1.7; body.add(agal);
      }
    } else {
      const top = M(CASUAL[Math.floor(r() * CASUAL.length)]), legs = M(kind === "sport" ? 0x1c1c26 : PANTS[Math.floor(r() * PANTS.length)]);
      const t = new Mesh(G.torso, top); t.position.y = 1.15; body.add(t); limbs(legs, top);
      const hair = new Mesh(G.hood, M(r() < 0.5 ? 0x1a120c : 0x3a2616)); hair.position.y = 1.6; hair.scale.set(0.9, 0.7, 0.9); body.add(hair);
      if (kind === "sport") { const cap = new Mesh(G.ring, M(0xffc23d)); cap.position.y = 1.66; cap.scale.set(1, 2, 1); body.add(cap); }
    }
    const robe = kind === "thobe" || kind === "abaya";
    return {
      obj, kind,
      step(ph, k) {
        const s = Math.sin(ph) * k;
        for (let i = 0; i < 2; i++) { const d = i ? -1 : 1; if (robe) L[i].position.z = s * 0.16 * d; else L[i].rotation.x = s * 0.55 * d; A[i].rotation.x = -s * 0.45 * d; }
        body.position.y = Math.abs(Math.cos(ph)) * 0.035 * k; body.rotation.z = Math.sin(ph) * 0.02 * k;
      },
      talk(time, seed) { head.rotation.y = Math.sin(time * 0.9 + seed) * 0.25; A[1].rotation.x = -0.25 - Math.max(0, Math.sin(time * 1.7 + seed)) * 0.5; }
    };
  }
  return person;
}

/**
 * @param {{ road:number, walk:number, zHome:number, zEnd:number, lampZ:number[], low:boolean }} o
 * @returns {{ group: Group, colliders: Box3[], update(dt:number, time:number, player:{x:number,z:number}):void }}
 */
export function buildStreetLife(o) {
  const r = rnd(4242), group = new Group(), colliders = [];
  const { road, walk, zHome, zEnd, lampZ, low } = o;

  /* ----- buildings: both sides, from the apartment block down to the plaza ----- */
  const fac = { glass: facadeTex("glass", r), stone: facadeTex("stone", r), hijazi: facadeTex("hijazi", r) };
  const facM = Object.fromEntries(Object.entries(fac).map(([k, t]) => [k, new MeshBasicMaterial({ map: t, color: new Color(1.15, 1.15, 1.15) })]));
  const shopM = SHOPS.map((s) => new MeshBasicMaterial({ map: shopTex(s), color: new Color(1.2, 1.2, 1.2) }));
  const shellM = new MeshStandardMaterial({ color: 0x15142a, roughness: 0.8 }), roofM = new MeshStandardMaterial({ color: 0x1d1b30, roughness: 0.7 });
  const awnC = [0xc8303a, 0x2fb383, 0xffc23d, 0x2f6fd6, 0x8a5cff, 0xf0a030].map((c) => new MeshStandardMaterial({ color: c, roughness: 0.6 }));
  const trimM = new MeshBasicMaterial({ color: new Color(0x2fe6ff).multiplyScalar(2.2) }), goldM = new MeshBasicMaterial({ color: new Color(0xffc23d).multiplyScalar(2.4) });
  const SHOP_H = 3.4, FLOOR = 3.2;
  let shopI = 0;
  for (const s of [-1, 1]) {
    let z = zHome;
    while (z > zEnd + 3) {
      const wz = 5.5 + r() * 3.5, depth = 9 + r() * 3, kind = ["glass", "stone", "hijazi"][Math.floor(r() * 3)];
      const floors = kind === "hijazi" ? 3 + Math.floor(r() * 3) : 4 + Math.floor(r() * (kind === "glass" ? 8 : 5));
      const h = SHOP_H + floors * FLOOR, cz = z - wz / 2, front = s * (walk + 0.45), cx = front + s * depth / 2;
      const shell = new Mesh(new BoxGeometry(depth, h, wz - 0.25), shellM); shell.position.set(cx, h / 2, cz); group.add(shell);
      // upper facade facing the street, UVs scaled to the floor/column count so one texture serves every building
      const up = new PlaneGeometry(wz - 0.25, h - SHOP_H), uv = up.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round((wz - 0.25) / 2.6)) / 2, uv.getY(i) * floors / 3);
      const face = new Mesh(up, facM[kind]); face.position.set(front - s * 0.01, SHOP_H + (h - SHOP_H) / 2, cz); face.rotation.y = -s * Math.PI / 2; group.add(face);
      // shop front + awning + a kerb-side step
      const shop = new Mesh(new PlaneGeometry(wz - 0.6, SHOP_H - 0.2), shopM[shopI % shopM.length]); shop.position.set(front - s * 0.02, (SHOP_H - 0.2) / 2 + 0.06, cz); shop.rotation.y = -s * Math.PI / 2; group.add(shop);
      const awn = new Mesh(new BoxGeometry(1.1, 0.08, wz - 1), awnC[shopI % awnC.length]); awn.position.set(front - s * 0.5, SHOP_H - 0.1, cz); awn.rotation.z = s * 0.22; group.add(awn);
      shopI++;
      // roof: a parapet and a neon trim line, gold on the Hijazi houses
      const par = new Mesh(new BoxGeometry(depth + 0.2, 0.5, wz - 0.05), roofM); par.position.set(cx, h + 0.25, cz); group.add(par);
      const trim = new Mesh(new BoxGeometry(0.06, 0.06, wz - 0.3), kind === "hijazi" ? goldM : trimM); trim.position.set(front - s * 0.04, h + 0.02, cz); group.add(trim);
      const band = new Mesh(new BoxGeometry(0.05, 0.05, wz - 0.3), kind === "glass" ? trimM : goldM); band.position.set(front - s * 0.04, SHOP_H + 0.02, cz); group.add(band);
      z -= wz;
    }
  }

  /* ----- trees: palms and round trees in planters, between the street lamps ----- */
  const treeZ = []; for (let i = 0; i < lampZ.length; i++) { const zz = lampZ[i] - 3.75; if (zz > zEnd + 1) treeZ.push(zz); }
  const spots = []; for (const z of treeZ) for (const s of [-1, 1]) spots.push({ x: s * (road + 1.4), z, palm: spots.length % 3 !== 2 });
  const palms = spots.filter((p) => p.palm), rounds = spots.filter((p) => !p.palm), dm = new Object3D();
  const planters = new InstancedMesh(new BoxGeometry(1.1, 0.42, 1.1), new MeshStandardMaterial({ color: 0x2a2840, roughness: 0.7 }), spots.length);
  const soil = new InstancedMesh(new BoxGeometry(0.95, 0.02, 0.95), new MeshStandardMaterial({ color: 0x1a2a16, roughness: 1 }), spots.length);
  const rims = new InstancedMesh(new BoxGeometry(1.14, 0.03, 1.14), goldM, spots.length);
  spots.forEach((p, i) => {
    dm.rotation.set(0, 0, 0); dm.scale.set(1, 1, 1);
    dm.position.set(p.x, 0.27, p.z); dm.updateMatrix(); planters.setMatrixAt(i, dm.matrix);
    dm.position.set(p.x, 0.49, p.z); dm.updateMatrix(); soil.setMatrixAt(i, dm.matrix);
    dm.position.set(p.x, 0.48, p.z); dm.updateMatrix(); rims.setMatrixAt(i, dm.matrix);
    colliders.push(new Box3(new Vector3(p.x - 0.6, 0, p.z - 0.6), new Vector3(p.x + 0.6, 2, p.z + 0.6)));
  });
  group.add(planters, soil, rims);
  const FR = 9;
  const trunk = new InstancedMesh(new CylinderGeometry(0.11, 0.19, 4.6, 7).translate(0, 2.3, 0), new MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 }), palms.length);
  const frondG = new BoxGeometry(0.32, 0.03, 2.1).translate(0, 0, 1.05);
  const frond = new InstancedMesh(frondG, new MeshStandardMaterial({ color: 0x2f9a58, roughness: 0.8 }), palms.length * FR);
  const dates = new InstancedMesh(new SphereGeometry(0.22, 6, 5), new MeshStandardMaterial({ color: 0xd08a2a, roughness: 0.7 }), palms.length);
  palms.forEach((p, i) => {
    const lean = (r() - 0.5) * 0.12, top = 4.95;
    dm.position.set(p.x, 0.48, p.z); dm.rotation.set(lean, 0, lean * 0.6); dm.scale.set(1, 1, 1); dm.updateMatrix(); trunk.setMatrixAt(i, dm.matrix);
    for (let k = 0; k < FR; k++) {
      dm.position.set(p.x + lean * 0.6 * top, 0.48 + top, p.z + lean * top); dm.rotation.set(0, 0, 0);
      dm.rotateY(k / FR * Math.PI * 2 + r() * 0.3); dm.rotateX(0.35 + r() * 0.35); dm.scale.set(1, 1, 0.85 + r() * 0.3); dm.updateMatrix();
      frond.setMatrixAt(i * FR + k, dm.matrix);
    }
    dm.position.set(p.x + lean * 0.6 * top, 0.48 + top - 0.25, p.z + lean * top); dm.rotation.set(0, 0, 0); dm.scale.set(1, 0.8, 1); dm.updateMatrix(); dates.setMatrixAt(i, dm.matrix);
  });
  const rTrunk = new InstancedMesh(new CylinderGeometry(0.1, 0.15, 2.2, 6).translate(0, 1.1, 0), trunk.material, rounds.length);
  const crown = new InstancedMesh(new IcosahedronGeometry(1, 1), new MeshStandardMaterial({ color: 0x2c8a4e, roughness: 0.85, flatShading: true }), rounds.length * 3);
  rounds.forEach((p, i) => {
    dm.rotation.set(0, 0, 0); dm.scale.set(1, 1, 1); dm.position.set(p.x, 0.48, p.z); dm.updateMatrix(); rTrunk.setMatrixAt(i, dm.matrix);
    const blobs = [[0, 3.0, 0, 1.15], [0.45, 2.6, 0.2, 0.8], [-0.4, 2.7, -0.25, 0.85]];
    blobs.forEach(([bx, by, bz, bs], k) => { dm.position.set(p.x + bx, 0.48 + by, p.z + bz); dm.rotation.set(r(), r(), r()); dm.scale.setScalar(bs); dm.updateMatrix(); crown.setMatrixAt(i * 3 + k, dm.matrix); });
  });
  group.add(trunk, frond, dates, rTrunk, crown);
  // soft uplight under every tree (additive quad, no real light)
  const glowM = new MeshBasicMaterial({ color: new Color(0xffc77a).multiplyScalar(0.6), transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false });
  const glow = new InstancedMesh(new CylinderGeometry(0.05, 0.42, 2.2, 8, 1, true).translate(0, 1.1, 0), glowM, spots.length);
  spots.forEach((p, i) => { dm.rotation.set(0, 0, 0); dm.scale.set(1, 1, 1); dm.position.set(p.x, 0.5, p.z); dm.updateMatrix(); glow.setMatrixAt(i, dm.matrix); });
  group.add(glow);

  /* ----- people: walkers on both pavements (one lane each way) and a few people chatting by the shops ----- */
  const person = makePeople(), walkers = [], groups = [];
  const zA = zHome - 0.6, zB = zEnd + 1, span = zA - zB;
  const n = low ? 8 : 16;
  for (let i = 0; i < n; i++) {
    const p = person(r), side = i % 2 ? 1 : -1, dir = (i >> 1) % 2 ? 1 : -1; // dir -1 = towards the tower
    const lane = side * (dir < 0 ? road + 2.2 : road + 2.85);
    const w = { p, x: lane, z: zB + r() * span, dir, speed: 1.05 + r() * 0.5, ph: r() * 6.28, k: 1 };
    p.obj.position.set(w.x, 0.06, w.z); p.obj.rotation.y = dir < 0 ? Math.PI : 0; group.add(p.obj); walkers.push(w);
  }
  if (!low) {
    for (let g = 0; g < 3; g++) {
      const side = g % 2 ? 1 : -1, z = zB + 4 + r() * (span - 8), x = side * (walk - 0.15), a = person(r), b = person(r);
      a.obj.position.set(x, 0.06, z + 0.45); b.obj.position.set(x, 0.06, z - 0.45);
      a.obj.rotation.y = Math.PI; b.obj.rotation.y = 0; group.add(a.obj, b.obj); groups.push({ a, b, s: r() * 10 });
      colliders.push(new Box3(new Vector3(x - 0.4, 0, z - 0.8), new Vector3(x + 0.4, 2, z + 0.8)));
    }
  }

  return {
    group, colliders,
    update(dt, time, pl) {
      for (const w of walkers) {
        // politely stop for the player rather than walking through them
        const ahead = (pl.z - w.z) * w.dir, near = Math.abs(pl.x - w.x) < 0.75 && ahead > 0 && ahead < 1.3;
        w.k += ((near ? 0 : 1) - w.k) * Math.min(1, dt * 6);
        w.z += w.dir * w.speed * w.k * dt; w.ph += dt * w.speed * 5.2 * w.k;
        if (w.z > zA) w.z = zB; else if (w.z < zB) w.z = zA;
        w.p.obj.position.z = w.z; w.p.step(w.ph, w.k);
      }
      for (const g of groups) { g.a.talk(time, g.s); g.b.talk(time, g.s + 2); }
    }
  };
}
