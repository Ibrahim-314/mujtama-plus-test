/* Chapter 1 — «الشارع». v2.94 stage 4: the apartment door opens onto the Digital City's boulevard; the player walks
 * (tap the road, or the joystick / keys) to the MJT tower — the Core from world/skyline.js — and goes in: the tower's
 * doors light up, the camera pushes in through a gold flash and the MJT hall (the terminal pages: balance, records,
 * wallet, mining, stats) opens over the paused street. Closing the hall leaves the player at the tower doors.
 * Built to be light on phones: the skyline is one instanced mesh with a shader, the street is a handful of planes and two
 * instanced meshes, the only real lights are a hemisphere + one directional (the character needs them), everything else
 * glows through emissive colour and bloom. Low tier: fewer buildings/particles (config.QUALITY via the renderer). */
import {
  Scene, PerspectiveCamera, Color, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry, BoxGeometry, CylinderGeometry,
  MeshBasicMaterial, MeshStandardMaterial, Vector3, Vector2, Raycaster, CanvasTexture, RepeatWrapping, SRGBColorSpace,
  InstancedMesh, Object3D, AdditiveBlending, DoubleSide, OctahedronGeometry, RingGeometry, CircleGeometry
} from "three";
import { buildSkyline } from "../world/skyline.js";
import { strip } from "../world/props.js";
import { buildStreetLife } from "../world/streetlife.js";
import { loadCharacter, Player } from "../world/player.js";
import { PALETTE, ASSET, charById } from "../config.js";
import { t, tl, fill } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";
import { openPause } from "../ui/menus.js";
import { CHAPTER1 as C } from "../story/chapter1.js";

const CORE_Z = -46;               // the tower's centre
const GATE_Z = CORE_Z + 8.2;      // the face of the tower's doors (body radius ≈ 7.5 at the base)
const HOME_Z = 4.2;               // the face of the apartment block
const ROAD = 4.6, WALK = 8.2;     // half widths: the road, the road + pavements
const STILL = { x: 0, y: 0, run: false };
const hot = (hex, k) => new Color(hex).multiplyScalar(k);

/** asphalt with lane dashes, a gold guide line to the tower, chevrons and a crosswalk in front of it (one texture, tiled in z) */
function roadTexture() {
  const w = 256, h = 1024, cv = document.createElement("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d");
  x.fillStyle = "#15161f"; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${0.03 + Math.random() * 0.05})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  x.fillStyle = "rgba(234,242,255,.55)"; for (let y = 0; y < h; y += 128) { x.fillRect(w * 0.25 - 3, y + 20, 6, 70); x.fillRect(w * 0.75 - 3, y + 20, 6, 70); }
  x.fillStyle = "rgba(234,242,255,.7)"; x.fillRect(8, 0, 5, h); x.fillRect(w - 13, 0, 5, h);
  x.fillStyle = "#ffc23d"; x.fillRect(w / 2 - 4, 0, 8, h);
  x.strokeStyle = "rgba(255,194,61,.85)"; x.lineWidth = 7; x.lineJoin = "round";
  for (let y = 70; y < h; y += 256) { x.beginPath(); x.moveTo(w / 2 - 30, y + 26); x.lineTo(w / 2, y); x.lineTo(w / 2 + 30, y + 26); x.stroke(); }
  const tx = new CanvasTexture(cv); tx.wrapS = tx.wrapT = RepeatWrapping; tx.colorSpace = SRGBColorSpace; tx.anisotropy = 8; return tx;
}
function paveTexture() {
  const n = 128, cv = document.createElement("canvas"); cv.width = cv.height = n; const x = cv.getContext("2d");
  x.fillStyle = "#24253a"; x.fillRect(0, 0, n, n); x.strokeStyle = "rgba(0,0,0,.45)"; x.lineWidth = 2;
  for (let i = 0; i <= n; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, n); x.moveTo(0, i); x.lineTo(n, i); x.stroke(); }
  const tx = new CanvasTexture(cv); tx.wrapS = tx.wrapT = RepeatWrapping; tx.colorSpace = SRGBColorSpace; return tx;
}
/** the apartment block's facade: rows of warm and cold windows, a few dark */
function facadeTexture() {
  const w = 256, h = 512, cv = document.createElement("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d");
  x.fillStyle = "#0d0f1f"; x.fillRect(0, 0, w, h);
  for (let r = 0; r < 16; r++) for (let c = 0; c < 8; c++) {
    const k = Math.random(); x.fillStyle = k < 0.35 ? "#1a1d33" : k < 0.75 ? "#ffcf8a" : "#8fd8ff";
    x.globalAlpha = k < 0.35 ? 1 : 0.55 + Math.random() * 0.45; x.fillRect(10 + c * 31, 12 + r * 31, 20, 18);
  }
  x.globalAlpha = 1; const tx = new CanvasTexture(cv); tx.colorSpace = SRGBColorSpace; return tx;
}
/** the sign over the tower's doors */
function signTexture() {
  const w = 512, h = 128, cv = document.createElement("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d");
  x.clearRect(0, 0, w, h); x.textAlign = "center"; x.textBaseline = "middle";
  x.shadowColor = "#ffc23d"; x.shadowBlur = 18; x.fillStyle = "#ffd76a"; x.font = "bold 70px sans-serif"; x.fillText("MJT", w / 2, 52);
  x.shadowBlur = 0; x.fillStyle = "#eaf2ff"; x.font = "26px sans-serif"; x.direction = "rtl"; x.fillText("برج مجتمع كوين · MUJTAMA COIN", w / 2, 106);
  const tx = new CanvasTexture(cv); tx.colorSpace = SRGBColorSpace; return tx;
}
/** soft round light pool on the ground under a street lamp */
function poolTexture() {
  const n = 128, cv = document.createElement("canvas"); cv.width = cv.height = n; const x = cv.getContext("2d");
  const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, "rgba(255,220,170,.55)"); g.addColorStop(0.5, "rgba(255,200,140,.18)"); g.addColorStop(1, "rgba(255,200,140,0)");
  x.fillStyle = g; x.fillRect(0, 0, n, n); return new CanvasTexture(cv);
}

export async function create(game, params = {}) {
  const save = game.save.data || {}, name = save.name || "…";
  const q = game.renderer.q, low = game.renderer.tier === "low";
  const scene = new Scene(); scene.background = new Color(PALETTE.fog);
  const camera = new PerspectiveCamera(55, 1, 0.1, 1400);

  // ---------- the city around the street ----------
  // the skyline's centre is the Core; the lot in front of it (the street and the apartment block) is kept clear
  const city = buildSkyline({ quality: q, radius: low ? 95 : 120, seed: 11, plaza: true, keep: (x, z) => !(Math.abs(x) < 26 && z > 16) });
  city.group.position.z = CORE_Z; scene.add(city.group);
  scene.add(new HemisphereLight(0x9fb4ff, 0x20122a, 1.25));
  const key = new DirectionalLight(0xffd59a, 1.6); key.position.set(0, 30, CORE_Z + 10); key.target.position.set(0, 0, 0); scene.add(key, key.target);
  const rim = new DirectionalLight(0x6fe9ff, 0.7); rim.position.set(-8, 6, 14); scene.add(rim);

  // ---------- the street ----------
  const len = HOME_Z - GATE_Z + 6, midZ = (HOME_Z + GATE_Z - 6) / 2;
  const roadTex = roadTexture(); roadTex.repeat.set(1, len / 16);
  const road = new Mesh(new PlaneGeometry(ROAD * 2, len), new MeshStandardMaterial({ map: roadTex, roughness: 0.55, metalness: 0.25, color: 0xc8c8d8 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, midZ); scene.add(road);
  const paveTex = paveTexture(); paveTex.repeat.set(2, len / 2.5);
  const paveM = new MeshStandardMaterial({ map: paveTex, roughness: 0.8, color: 0xb0b4d0 });
  for (const s of [-1, 1]) {
    const pv = new Mesh(new PlaneGeometry(WALK - ROAD, len), paveM); pv.rotation.x = -Math.PI / 2; pv.position.set(s * (ROAD + WALK) / 2, 0.06, midZ); scene.add(pv);
    const curb = new Mesh(new BoxGeometry(0.18, 0.12, len), new MeshStandardMaterial({ color: 0x3a3d5c, roughness: 0.6 })); curb.position.set(s * ROAD, 0.06, midZ); scene.add(curb);
    scene.add(strip(new Vector3(s * (ROAD + 0.1), 0.13, HOME_Z), new Vector3(s * (ROAD + 0.1), 0.13, GATE_Z - 4), s > 0 ? PALETTE.cyan : PALETTE.magenta, 2.2, 0.03));
    scene.add(strip(new Vector3(s * WALK, 0.07, HOME_Z), new Vector3(s * WALK, 0.07, GATE_Z - 4), PALETTE.violet, 1.6, 0.04));
  }
  // the plaza in front of the tower: a gold disc under the doors
  const plaza = new Mesh(new CircleGeometry(12, 64), new MeshStandardMaterial({ color: 0x1b1a2c, roughness: 0.35, metalness: 0.6 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(0, 0.03, CORE_Z + 6); scene.add(plaza);

  // street lamps: one instanced pole mesh + one instanced head mesh, a fake light pool under each (no real lights)
  const lampZ = []; for (let z = HOME_Z - 4; z > GATE_Z + 2; z -= 7.5) lampZ.push(z);
  const nl = lampZ.length * 2, dm = new Object3D();
  const poles = new InstancedMesh(new CylinderGeometry(0.07, 0.1, 5, 6), new MeshStandardMaterial({ color: 0x2b2e48, roughness: 0.5, metalness: 0.7 }), nl);
  const heads = new InstancedMesh(new BoxGeometry(1.1, 0.12, 0.34), new MeshBasicMaterial({ color: hot(0xffe2b0, 3.2) }), nl);
  const poolM = new MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.9 });
  const poolG = new PlaneGeometry(5, 5);
  let i = 0;
  for (const z of lampZ) for (const s of [-1, 1]) {
    const x = s * (ROAD + 1.4);
    dm.position.set(x, 2.5, z); dm.rotation.set(0, 0, 0); dm.updateMatrix(); poles.setMatrixAt(i, dm.matrix);
    dm.position.set(x - s * 0.45, 4.95, z); dm.updateMatrix(); heads.setMatrixAt(i, dm.matrix); i++;
    const pool = new Mesh(poolG, poolM); pool.rotation.x = -Math.PI / 2; pool.position.set(x - s * 0.9, 0.08, z); scene.add(pool);
  }
  scene.add(poles, heads);

  // the life of the street: buildings with shops along both pavements, palms and trees in planters, people walking by
  const life = buildStreetLife({ road: ROAD, walk: WALK, zHome: HOME_Z, zEnd: CORE_Z + 18, lampZ, low });
  scene.add(life.group);

  // the apartment block behind the player: a lit facade with the entrance the player just came out of
  const facade = new Mesh(new BoxGeometry(18, 46, 10), [
    new MeshBasicMaterial({ color: 0x0b0d1c }), new MeshBasicMaterial({ color: 0x0b0d1c }), new MeshBasicMaterial({ color: 0x0b0d1c }),
    new MeshBasicMaterial({ color: 0x0b0d1c }), new MeshBasicMaterial({ color: 0x0b0d1c }), new MeshBasicMaterial({ map: facadeTexture(), color: new Color(1.3, 1.3, 1.3) })
  ]);
  facade.position.set(0, 23, HOME_Z + 5); scene.add(facade);
  const homeGlow = new Mesh(new PlaneGeometry(1.6, 2.4), new MeshBasicMaterial({ color: hot(0xffd9a0, 1.8), transparent: true, opacity: 0.95 }));
  homeGlow.position.set(0, 1.2, HOME_Z - 0.01); homeGlow.rotation.y = Math.PI; scene.add(homeGlow);
  scene.add(strip(new Vector3(-0.85, 0.02, HOME_Z - 0.03), new Vector3(-0.85, 2.45, HOME_Z - 0.03), PALETTE.gold, 3, 0.04));
  scene.add(strip(new Vector3(0.85, 0.02, HOME_Z - 0.03), new Vector3(0.85, 2.45, HOME_Z - 0.03), PALETTE.gold, 3, 0.04));
  scene.add(strip(new Vector3(-0.85, 2.45, HOME_Z - 0.03), new Vector3(0.85, 2.45, HOME_Z - 0.03), PALETTE.gold, 3, 0.04));

  // the tower's doors: two gold pillars, a lintel with the MJT sign, a glowing glass door that brightens as you arrive
  const gate = new Object3D(); gate.position.set(0, 0, GATE_Z); scene.add(gate);
  const pillarM = new MeshBasicMaterial({ color: hot(PALETTE.gold, 2.4) });
  for (const s of [-1, 1]) { const p = new Mesh(new BoxGeometry(0.35, 4.6, 0.35), pillarM); p.position.set(s * 2.1, 2.3, 0.25); gate.add(p); }
  const lintel = new Mesh(new BoxGeometry(4.6, 0.3, 0.4), pillarM); lintel.position.set(0, 4.6, 0.25); gate.add(lintel);
  const doorM = new MeshBasicMaterial({ color: hot(PALETTE.cyan, 0.9), transparent: true, opacity: 0.75, side: DoubleSide });
  const gdoor = new Mesh(new PlaneGeometry(3.85, 4.45), doorM); gdoor.position.set(0, 2.23, 0.1); gate.add(gdoor);
  const sign = new Mesh(new PlaneGeometry(4.6, 1.15), new MeshBasicMaterial({ map: signTexture(), transparent: true, color: new Color(1.8, 1.8, 1.8), depthWrite: false }));
  sign.position.set(0, 5.5, 0.3); gate.add(sign);
  const backing = new Mesh(new BoxGeometry(5.4, 6.6, 1.2), new MeshStandardMaterial({ color: 0x0c0b16, roughness: 0.4, metalness: 0.7 })); backing.position.set(0, 3.3, -0.45); gate.add(backing);

  // ---------- the two places you can use, with the same glowing markers as the room ----------
  const things = [
    { id: "tower", at: new Vector3(0, 0, GATE_Z + 1.4), mark: new Vector3(0, 7, GATE_Z + 0.4), face: new Vector3(0, 0, GATE_Z - 3), hitAt: new Vector3(0, 2.2, GATE_Z + 0.4), hitS: [5, 5, 2] },
    { id: "home", at: new Vector3(0, 0, HOME_Z - 1.1), mark: new Vector3(0, 3.1, HOME_Z - 0.2), face: new Vector3(0, 0, HOME_Z + 3), hitAt: new Vector3(0, 1.3, HOME_Z - 0.2), hitS: [2.2, 2.6, 0.8] }
  ];
  const markGeo = new OctahedronGeometry(0.16, 0), haloGeo = new RingGeometry(0.5, 0.6, 40);
  for (const th of things) {
    const col = th.id === "tower" ? PALETTE.gold : PALETTE.cyan;
    th.m = new Mesh(markGeo, new MeshBasicMaterial({ color: hot(col, 3) })); th.m.position.copy(th.mark); if (th.id === "tower") th.m.scale.setScalar(2.2); scene.add(th.m);
    th.h = new Mesh(haloGeo, new MeshBasicMaterial({ color: hot(col, 2.2), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false })); th.h.rotation.x = -Math.PI / 2; th.h.position.set(th.at.x, 0.1, th.at.z); scene.add(th.h);
    th.hit = new Mesh(new BoxGeometry(...th.hitS), new MeshBasicMaterial({ visible: false })); th.hit.position.copy(th.hitAt); th.hit.userData.thing = th; scene.add(th.hit);
  }
  // an invisible ground plane for taps (the visible ground is split into many pieces)
  const tapFloor = new Mesh(new PlaneGeometry(60, 120), new MeshBasicMaterial({ visible: false })); tapFloor.rotation.x = -Math.PI / 2; tapFloor.position.set(0, 0, midZ); scene.add(tapFloor);

  // ---------- the player ----------
  const ch = await loadCharacter(save.char || "hoodie", 1.72);
  const player = new Player(ch, game.audio); player.addTo(scene);
  const back = params.from === "tower";
  player.pos.set(0, 0, back ? GATE_Z + 2.2 : HOME_Z - 1.4); player.heading = back ? 0 : Math.PI;
  const world = { colliders: life.colliders, bounds: { minX: -WALK + 0.2, maxX: WALK - 0.2, minZ: GATE_Z + 0.55, maxZ: HOME_Z - 0.45 } };

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
    <section class="gm-obj" id="gm-obj"><span class="gm-obj-k">${esc(tl(C.title))} · ${esc(tl(C.name))}</span><b>${esc(tl(C.objective))}</b>
      <ul><li data-g="tower">${icon("check")}<span>${esc(tl(C.things.tower.label))}</span></li></ul></section>
    <p class="gm-help" id="gm-help">${esc(game.input.touch ? t("المس الطريق لتمشي · المس البرج لتدخله", "Tap the road to walk · tap the tower to go in") : t("WASD أو الأسهم للتحرك · انقر للمشي · E للدخول", "WASD / arrows or click to walk · E to enter"))}</p>
    <button type="button" class="gm-act" id="gm-act" hidden data-sfx="click"><span class="gm-act-i">${icon("hand")}</span><span class="gm-act-t"><small id="gm-act-k"></small><b id="gm-act-v"></b></span></button>
    <div class="gm-card" id="gm-card" hidden><small></small><b></b></div>`, "gm-room gm-street");
  const $ = (s) => L.querySelector(s);
  const paintObj = () => { $("[data-g=tower]").classList.toggle("ok", !!game.save.flag("street.tower")); };
  const refreshBal = () => { if (!game.member) { $("#gm-bal").textContent = "—"; return; } game.host.api("GET", "/api/mjt/me").then((m) => { $("#gm-bal").textContent = String(m.balance.mjt); }, () => { $("#gm-bal").textContent = "—"; }); };
  refreshBal(); paintObj();
  $("#gm-menu").addEventListener("click", () => openPause(game));
  game.input.on("pause", () => { if (game.scenes.name === "street" && !game.ui.modalOpen && !busy) openPause(game); });
  function card(k, v) { const c = $("#gm-card"); c.querySelector("small").textContent = k; c.querySelector("b").textContent = v; c.hidden = false; c.classList.remove("on"); void c.offsetWidth; c.classList.add("on"); setTimeout(() => { c.hidden = true; }, 3200); }

  // ---------- interaction ----------
  let near = null, busy = false, inHall = false, helpGone = false, push = null, glow = 0;
  const showAct = (th) => { const a = $("#gm-act"); if (!th) { a.hidden = true; return; } $("#gm-act-k").textContent = tl(C.things[th.id].label); $("#gm-act-v").textContent = tl(C.things[th.id].verb); a.hidden = false; a.dataset.goal = th.id === "tower" ? "1" : ""; };
  const hideHelp = () => { if (helpGone) return; helpGone = true; $("#gm-help").classList.add("gone"); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const flash = (on) => game.root.classList.toggle("gm-flash-on", on);

  async function use(th) {
    if (busy) return; busy = true; showAct(null); player.walkTo(null); player.face(th.face.x, th.face.z);
    try {
      if (th.id === "tower") {
        // the doors brighten, the player steps in, the camera pushes through the doors into a gold flash
        game.audio.sfx("open"); glow = 1;
        player.walkTo({ x: 0, z: GATE_Z + 0.6 });
        push = { from: camera.position.clone(), to: new Vector3(0, 2.4, GATE_Z + 3.2), lf: look.clone(), look: new Vector3(0, 2.2, GATE_Z - 6), k: 0 };
        await wait(900); game.audio.sfx("whoosh"); flash(true); await wait(380);
        if (!game.save.flag("street.tower")) { game.save.set({ flags: { "street.tower": true } }); game.audio.sfx("ping"); paintObj(); }
        game.save.flush();
        // the MJT hall: the terminal pages open over the paused street (the hall's room strip moves between them)
        game.host.openStation("balance");
        await wait(250); flash(false);
        // when the hall closes the player is back outside the doors (onStationClose clears busy)
        inHall = true; return;
      }
      if (th.id === "home") {
        game.audio.sfx("open"); game.scenes.reg.room?.().catch(() => { }); player.walkTo({ x: 0, z: HOME_Z - 0.5 });
        push = { from: camera.position.clone(), to: new Vector3(0, 2.0, HOME_Z - 3.6), lf: look.clone(), look: new Vector3(0, 1.3, HOME_Z + 4), k: 0 };
        await wait(700); game.audio.sfx("whoosh"); flash(true); await wait(320);
        await game.scenes.go("room", { from: "door", fade: 250, fadeIn: 600 }); flash(false);
        return;
      }
    } finally { if (!inHall) busy = false; }
  }
  const onStationClose = () => {
    if (game.scenes.name !== "street") return;
    refreshBal(); push = null; glow = 0; busy = false; inHall = false; flash(false);
    player.walkTo(null); player.pos.set(0, 0, GATE_Z + 2.2); player.heading = 0;
    card(tl(C.things.tower.label), t("عدت إلى الشارع", "Back on the street"));
  };
  game.bus.on("station-closed", onStationClose);
  $("#gm-act").addEventListener("click", () => { if (near) use(near); });
  game.input.on("action", () => { if (game.scenes.name === "street" && near && !busy && !game.ui.modalOpen) use(near); });
  const ray = new Raycaster(), ndc = new Vector2(), hits = [tapFloor, ...things.map((x) => x.hit)];
  let pending = null;
  const canWalk = () => !busy && !game.ui.modalOpen && game.scenes.name === "street";
  // walk to a point on the road (clamped to the street) — the tap handler and the game's own tests both come through here
  function walk(x, z) {
    if (!canWalk()) return false;
    const b = world.bounds; pending = null;
    player.walkTo({ x: Math.max(b.minX + 0.4, Math.min(b.maxX - 0.4, x)), z: Math.max(b.minZ + 0.4, Math.min(b.maxZ - 0.4, z)) });
    hideHelp(); return true;
  }
  game.input.on("tap", (p) => {
    if (!canWalk()) return;
    ndc.set(p.x, p.y); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hits, false)[0]; if (!hit) return;
    const th = hit.object.userData.thing;
    if (th) { pending = th; player.walkTo(th.at); hideHelp(); } else walk(hit.point.x, hit.point.z);
  });
  player.onArrive = () => { if (pending) { const th = pending; pending = null; use(th); } };

  // ---------- camera: behind and above the player, looking up the street at the tower ----------
  const camT = new Vector3(), camP = new Vector3(), look = new Vector3();
  const frame = () => { camera.fov = camera.aspect < 0.8 ? 62 : 52; camera.updateProjectionMatrix(); };
  game.renderer.onResize = frame;
  const goalCam = () => {
    const portrait = camera.aspect < 0.8, back = portrait ? 8.6 : 7.2, up = portrait ? 4.6 : 3.8;
    camP.set(player.pos.x * 0.6, up, player.pos.z + back);
    camT.set(player.pos.x * 0.4, 2.4, player.pos.z - 9);
  };
  goalCam();
  // arrival from the door: the camera starts in the doorway at eye height looking up at the tower, then settles behind
  let intro = !back ? { k: 0 } : null;
  if (intro) { camera.position.set(0, 1.7, HOME_Z - 0.4); look.set(0, 22, CORE_Z); } else { camera.position.copy(camP); look.copy(camT); }
  camera.lookAt(look);

  game.street = { use: (id) => { const th = things.find((x) => x.id === id); if (th) return use(th); }, walk, player, gate: GATE_Z, home: HOME_Z, state: () => ({ busy, intro: !!intro, target: player.target && { x: player.target.x, z: player.target.z }, locked: player.locked, near: near && near.id }) }; // the game's own tests

  return {
    scene, camera, bloom: { strength: low ? 0.6 : 0.75, radius: 0.5, threshold: 0.82 },
    enter() {
      frame(); game.audio.music("room"); game.audio.ambient("city");
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
      player.update(dt, busy ? STILL : mv, 0, world);
      let best = null, bd = 1.6;
      for (const th of things) {
        const d = Math.hypot(th.at.x - player.pos.x, th.at.z - player.pos.z); if (d < bd) { bd = d; best = th; }
        th.m.position.y = th.mark.y + Math.sin(time * 2.2 + th.mark.z) * 0.1; th.m.rotation.y += dt * 1.6;
        th.h.material.opacity += (((th === best) ? 0.9 : 0) - th.h.material.opacity) * Math.min(1, dt * 8);
      }
      if (best !== near) { near = best; if (!busy) { showAct(near); if (near) game.audio.sfx("hover"); } }
      if (busy && !$("#gm-act").hidden) showAct(null);
      // the tower doors breathe, and burn bright when you go in
      const g = 0.75 + Math.sin(time * 2) * 0.15 + glow * 2.2; doorM.color.copy(new Color(PALETTE.cyan)).multiplyScalar(g);
      // camera
      goalCam();
      if (push) {
        push.k = Math.min(1, push.k + dt * 0.95); const e = push.k * push.k * (3 - 2 * push.k);
        camera.position.lerpVectors(push.from, push.to, e); look.lerpVectors(push.lf, push.look, e);
      } else if (intro && intro.k > 0) {
        intro.k = Math.min(1, intro.k + dt * 0.5); const e = intro.k * intro.k * (3 - 2 * intro.k);
        camera.position.lerp(camP, Math.min(1, dt * (0.5 + e * 3))); look.lerp(camT, Math.min(1, dt * (0.5 + e * 3)));
      } else if (!intro) { camera.position.lerp(camP, Math.min(1, dt * 3)); look.lerp(camT, Math.min(1, dt * 3.5)); }
      camera.lookAt(look);
      city.update(dt, time);
      life.update(dt, time, player.pos);
    },
    exit() { flash(false); game.save.flush(); },
    dispose() { game.street = null; game.renderer.onResize = null; game.bus.off("station-closed", onStationClose); game.input.clear(); }
  };
}
