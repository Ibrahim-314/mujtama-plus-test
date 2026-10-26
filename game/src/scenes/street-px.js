/* Chapter 1 — «الشارع», in 2D pixel art (top-down 3/4 view, 2026-10-27 world conversion).
 * The boulevard of the Digital City in 2077, ten years after the Great Blackout: neon shopfronts, warm lamps, dark
 * districts, parked and passing cars, people on the pavements, and at the end of the road the golden MJT tower with its
 * glowing coin. Same coordinates, story, save flags, server missions, HUD, overlays and game.street test hooks as the
 * 3D street (scenes/street.js, still there as the 3D option): Salma at the door, the dead terminal and Sada, the
 * underground market and Abu Nasser, the restricted service entrance, the old maintenance panel and its window. */
import { makeView, PPM, glow, marker, halo, bake, rng, clamp, text, textW } from "../px/core.js";
import { PxHero } from "../px/hero.js";
import { drawPerson, facing } from "../px/sprites.js";
import { ASSET, CHARS, charById } from "../config.js";
import { t, tl, fill } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";
import { openPause } from "../ui/menus.js";
import { CHAPTER1 as C } from "../story/chapter1.js";
import { openTower } from "../os/tower.js";

const CORE_Z = -46, GATE_Z = CORE_Z + 8.2, HOME_Z = 4.2, ROAD = 5, WALK = 9;
const STILL = { x: 0, y: 0, run: false };
const midZ = (HOME_Z + GATE_Z) / 2 - 2;
const XZ0 = -10.5, XZ1 = -5.5; // a cross street where the city's traffic runs
const Z0 = CORE_Z - 30, Z1 = HOME_Z + 14; // the drawn extent of the street

/** the ground, baked once in strips: asphalt with lane dashes and the gold guide line, pavements, kerbs, the plaza */
function groundTex() {
  const X0 = -WALK - 14, w = (WALK + 14) * 2 * PPM, h = (Z1 - Z0) * PPM, R = rng(91);
  const cv = bake(w, h, (c) => {
    const X = (x) => Math.round((x - X0) * PPM), Y = (z) => Math.round((z - Z0) * PPM);
    c.fillStyle = "#101220"; c.fillRect(0, 0, w, h);
    // pavements: 1 m slabs with seams
    for (const s of [-1, 1]) {
      const a = s < 0 ? X(-WALK) : X(ROAD), b = s < 0 ? X(-ROAD) : X(WALK);
      c.fillStyle = "#2a2c3c"; c.fillRect(a, 0, b - a, h);
      for (let y = 0; y < h; y += PPM) { c.fillStyle = "#22243a"; c.fillRect(a, y, b - a, 1); }
      for (let x = a; x < b; x += PPM) { c.fillStyle = "#22243a"; c.fillRect(x, 0, 1, h); }
      for (let i = 0; i < (b - a) * h / 90; i++) { c.fillStyle = R() < 0.5 ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.12)"; c.fillRect(a + R() * (b - a), R() * h, 1, 1); }
      c.fillStyle = "#4a4c62"; c.fillRect(s < 0 ? X(-ROAD) - 2 : X(ROAD), 0, 2, h); // the kerb
    }
    // the road: asphalt grain, lane dashes, the edge lines, the gold guide line to the tower
    c.fillStyle = "#15161f"; c.fillRect(X(-ROAD), 0, X(ROAD) - X(-ROAD), h);
    for (let i = 0; i < (X(ROAD) - X(-ROAD)) * h / 40; i++) { c.fillStyle = R() < 0.5 ? "rgba(255,255,255,.035)" : "rgba(0,0,0,.18)"; c.fillRect(X(-ROAD) + R() * (X(ROAD) - X(-ROAD)), R() * h, 1, 1); }
    c.fillStyle = "rgba(234,242,255,.6)"; c.fillRect(X(-ROAD) + 3, 0, 1, h); c.fillRect(X(ROAD) - 4, 0, 1, h);
    for (let y = 0; y < h; y += 48) { c.fillStyle = "rgba(234,242,255,.5)"; c.fillRect(X(-2.5), y, 1, 20); c.fillRect(X(2.5), y, 1, 20); }
    c.fillStyle = "#c8962c"; c.fillRect(X(0) - 1, Y(GATE_Z + 3), 2, Y(HOME_Z) - Y(GATE_Z + 3));
    c.fillStyle = "#ffc23d"; for (let z = GATE_Z + 6; z < HOME_Z - 2; z += 8) { const y = Y(z); for (let i = 0; i < 5; i++) { c.fillRect(X(0) - 6 + i, y + 5 - i, 2, 1); c.fillRect(X(0) + 4 - i, y + 5 - i, 2, 1); } }
    // the cross street: asphalt either side of the boulevard, zebra crossings over the pavements
    c.fillStyle = "#15161f"; c.fillRect(0, Y(XZ0), X(-ROAD), Y(XZ1) - Y(XZ0)); c.fillRect(X(ROAD), Y(XZ0), w - X(ROAD), Y(XZ1) - Y(XZ0));
    c.fillStyle = "rgba(234,242,255,.5)"; for (let x = 0; x < w; x += 40) { if (x > X(-WALK) - 20 && x < X(WALK)) continue; c.fillRect(x, Y((XZ0 + XZ1) / 2), 20, 1); }
    for (const s of [-1, 1]) for (let z = XZ0 + 0.4; z < XZ1 - 0.3; z += 0.8) { c.fillStyle = "rgba(234,242,255,.45)"; c.fillRect(s < 0 ? X(-WALK) : X(ROAD), Y(z), X(WALK) - X(ROAD), 6); }
    // a crosswalk in front of the tower
    for (let x = -ROAD + 0.4; x < ROAD - 0.4; x += 0.9) { c.fillStyle = "rgba(234,242,255,.55)"; c.fillRect(X(x), Y(GATE_Z + 2.4), 7, Y(GATE_Z + 4.4) - Y(GATE_Z + 2.4)); }
    // the tower's plaza: polished stone in a gold-lined circle
    c.fillStyle = "#26222e"; c.beginPath(); c.ellipse(X(0), Y(CORE_Z), 15 * PPM, 15 * PPM, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#7a5a1c"; c.lineWidth = 2; c.beginPath(); c.ellipse(X(0), Y(CORE_Z), 15 * PPM, 15 * PPM, 0, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = "rgba(255,194,61,.25)"; c.lineWidth = 1; for (let r = 11; r < 12; r += 2) { c.beginPath(); c.ellipse(X(0), Y(CORE_Z), r * PPM, r * PPM, 0, 0, Math.PI * 2); c.stroke(); }
    // the doorway of the apartment block the player came out of
    c.fillStyle = "#3a3048"; c.fillRect(X(-1.4), Y(HOME_Z - 1.2), X(1.4) - X(-1.4), Y(HOME_Z) - Y(HOME_Z - 1.2));
  });
  return { cv, X0 };
}

/** the city blocks either side of the boulevard: rooftops (AC units, vents, antennas, neon edges), a lit shopfront row
 * along the pavement, and a sign over each shop. Some blocks are still dark since the blackout. */
function blocks() {
  const R = rng(2077), out = [];
  const one = (s, z0, z1) => out.push({ s, z0, z1, dark: R() < 0.22, hue: ["#ff3fb4", "#2fe6ff", "#ffc23d", "#8a5cff", "#3dffb0"][Math.floor(R() * 5)], roof: ["#1d1f33", "#22243a", "#1a1b2c", "#24203a"][Math.floor(R() * 4)], seed: Math.floor(R() * 1e6), sign: ["MJT", "CAFE", "OPEN", "24H", "NET", "SOUQ", "TECH", "LAB"][Math.floor(R() * 8)] });
  for (const s of [-1, 1]) {
    let z = HOME_Z - 1;
    while (z > GATE_Z + 4) {
      let len = 6 + Math.floor(R() * 6);
      if (z > XZ1 && z - len < XZ1 + 0.2) { len = z - XZ1 - 0.2; if (len >= 2) one(s, z - len, z); z = XZ0 - 0.2; continue; } // stop at the cross street
      len = Math.min(len, z - (GATE_Z + 4)); if (len < 2) break;
      one(s, z - len, z); z -= len + 0.4;
    }
  }
  return out;
}

export async function create(game, params = {}) {
  const save = game.save.data || {}, name = save.name || "…";
  const view = makeView(game, (cw, ch) => (cw / ch < 0.8 ? [13, 20] : [26, 15]));
  game.root.classList.add("gm-pxw");
  const G = groundTex(), BLOCKS = blocks(), R = rng(7);
  const colliders = [];

  // ---------- the street furniture: lamps, trees in planters, benches, parked cars (and what you can't walk through) ----------
  const lamps = [], trees = [], benches = [], parked = [];
  for (let z = HOME_Z - 4; z > GATE_Z + 4; z -= 8) for (const s of [-1, 1]) { lamps.push({ x: s * (ROAD + 0.5), z }); colliders.push({ min: { x: s * (ROAD + 0.5) - 0.15, z: z - 0.15 }, max: { x: s * (ROAD + 0.5) + 0.15, z: z + 0.15 } }); }
  for (let z = HOME_Z - 8; z > GATE_Z + 6; z -= 8) for (const s of [-1, 1]) {
    const x = s * (WALK - 0.9);
    if (Math.abs(z - midZ) < 2.5 || Math.abs(z - (midZ - 6)) < 3.5 || (z > XZ0 - 1 && z < XZ1 + 1)) continue; // the terminal and the market stairs stand here
    if (R() < 0.6) { trees.push({ x, z }); colliders.push({ min: { x: x - 0.5, z: z - 0.5 }, max: { x: x + 0.5, z: z + 0.5 } }); }
    else { benches.push({ x, z }); colliders.push({ min: { x: x - 0.3, z: z - 0.8 }, max: { x: x + 0.3, z: z + 0.8 } }); }
  }
  for (let z = HOME_Z - 7; z > GATE_Z + 8; z -= 6.5) for (const s of [-1, 1]) if (R() < 0.45 && (z < XZ0 - 1.5 || z > XZ1 + 1.5)) parked.push({ x: s * (ROAD - 0.9), z, col: ["#a8287a", "#1d6f8a", "#c8962c", "#3a3a4a", "#e8eef8", "#1f7a5a"][Math.floor(R() * 6)] });
  for (const p of parked) colliders.push({ min: { x: p.x - 0.6, z: p.z - 1.3 }, max: { x: p.x + 0.6, z: p.z + 1.3 } });
  // cars passing on the far lanes (they slow and stop for you)
  const cars = [{ x: -30, z: XZ0 + 1.4, v: 0, dir: 1, col: "#2fe6ff" }, { x: 12, z: XZ1 - 1.4, v: 0, dir: -1, col: "#ff3fb4" }, { x: -8, z: XZ0 + 1.4, v: 0, dir: 1, col: "#ffc23d" }];

  // ---------- the places you can use (the same spots as the 3D street) ----------
  const things = [
    { id: "tower", at: { x: 0, z: GATE_Z + 1.4 }, mark: { x: 0, z: GATE_Z, y: 5.2 }, face: { x: 0, z: GATE_Z - 3 }, hit: { x: 0, z: GATE_Z - 1.5, r: 3.2 } },
    { id: "signal", at: { x: -(ROAD + 1.5), z: midZ + 1.2 }, mark: { x: -(ROAD + 2.4), z: midZ, y: 2.8 }, face: { x: -(ROAD + 2.4), z: midZ } },
    { id: "market", at: { x: ROAD + 1.5, z: midZ - 6 + 1.2 }, mark: { x: ROAD + 2.6, z: midZ - 6, y: 2.6 }, face: { x: ROAD + 2.6, z: midZ - 6 + 1.8 } },
    { id: "service", at: { x: ROAD + 2.0, z: GATE_Z + 1.5 }, mark: { x: ROAD + 2.0, z: GATE_Z - 0.1, y: 4.4 }, face: { x: ROAD + 2.0, z: GATE_Z - 2 } },
    { id: "maint", at: { x: -(ROAD + 2.0), z: GATE_Z + 1.5 }, mark: { x: -(ROAD + 2.0), z: GATE_Z - 0.2, y: 3.0 }, face: { x: -(ROAD + 2.0), z: GATE_Z - 2 } },
    { id: "home", at: { x: 0, z: HOME_Z - 1.1 }, mark: { x: 0, z: HOME_Z - 0.2, y: 2.6 }, face: { x: 0, z: HOME_Z + 3 } }
  ];
  for (const th of things) th.a = 0;
  const byId = (id) => things.find((x) => x.id === id);
  const sig = byId("signal"), mk = byId("market"), svc = byId("service"), mt = byId("maint");
  const sigLive = () => !!game.save.flag("story.salma") && !game.save.flag("story.sada");
  const mkLive = () => !!game.save.flag("story.route") && !game.save.flag("story.record");
  const svcLive = () => !!game.save.flag("story.record") && !game.save.flag("story.service");
  let win = null; // Phase 5: the limited maintenance window { until } (this session only; the code step is saved)
  const winOpen = () => !!win && !game.save.flag("story.maint");
  const mtLive = () => !!game.save.flag("story.service") && !game.save.flag("story.maint") && !winOpen();
  const storyGoal = () => (sigLive() ? sig : mkLive() ? mk : svcLive() || winOpen() ? svc : mtLive() ? mt : null);
  const liveOf = (th) => (th === sig ? sigLive() : th === mk ? mkLive() : th === svc ? svcLive() || winOpen() : th === mt ? mtLive() : true);
  colliders.push(
    { min: { x: sig.face.x - 0.35, z: midZ - 0.55 }, max: { x: sig.face.x + 0.35, z: midZ + 0.55 } },
    { min: { x: mk.face.x - 0.75, z: midZ - 6 - 1.15 }, max: { x: mk.face.x + 0.75, z: midZ - 6 + 1.15 } },
    { min: { x: mk.face.x - 0.2, z: midZ - 6 + 1.8 }, max: { x: mk.face.x + 0.6, z: midZ - 6 + 2.6 } },
    { min: { x: svc.at.x - 1.45, z: GATE_Z - 1.25 }, max: { x: svc.at.x + 1.45, z: GATE_Z + 0.08 } },
    { min: { x: mt.at.x - 0.65, z: GATE_Z - 0.85 }, max: { x: mt.at.x + 0.65, z: GATE_Z - 0.25 } }
  );
  // what the story scenes animate (presentation only)
  const fx = { towerDoor: 0, svcOpen: 0, reader: "#ffb020", readerK: 0.3, svcLight: 0.2, mtScreen: 0.08, sigScreen: 0.05 };

  // ---------- the player, Salma, Abu Nasser, the people on the pavements ----------
  const player = new PxHero(save.char || "hoodie", game.audio);
  const back = params.from === "tower";
  const sp = !back && !params.from && save.scene === "street" && save.pos ? save.pos : null;
  if (sp) { player.pos.set(clamp(Number(sp.x) || 0, -WALK + 0.6, WALK - 0.6), 0, clamp(Number(sp.z) || 0, GATE_Z + 1.2, HOME_Z - 1.0)); player.heading = Number(sp.r) || Math.PI; }
  else { player.pos.set(0, 0, back ? GATE_Z + 2.2 : HOME_Z - 1.4); player.heading = back ? 0 : Math.PI; }
  let leaving = false, spotT = 0, lastSpot = "";
  const saveSpot = () => { const p = { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), r: +player.heading.toFixed(2) }; const k = JSON.stringify(p); if (k !== lastSpot) { lastSpot = k; game.save.set({ scene: "street", pos: p }); } };
  const world = { colliders, bounds: { minX: -WALK + 0.2, maxX: WALK - 0.2, minZ: GATE_Z + 0.55, maxZ: HOME_Z - 0.45 } };
  const salma = new PxHero("salma", null, { npc: true }); salma.pos.set(1.9, 0, GATE_Z + 1.1); salma.heading = 0;
  const nasser = new PxHero("nasser", null, { npc: true }); nasser.pos.set(mk.face.x - 0.5, 0, midZ - 6 + 1.6); nasser.heading = -Math.PI / 2;
  const others = CHARS.map((c) => c.id).filter((id) => id !== (save.char || "hoodie"));
  const walkers = [];
  for (let i = 0; i < 5; i++) {
    const h = new PxHero(others[i % others.length], null, { npc: true }); h.pace = 0.95 + R() * 0.4;
    const s = i % 2 ? 1 : -1, lane = s * (WALK - 3.0 + R() * 0.6);
    h.pos.set(lane, 0, HOME_Z - 3 - R() * 30); h.dir = R() < 0.5 ? -1 : 1; h.lane = lane; h.heading = h.dir < 0 ? Math.PI : 0; h.pause = 0;
    walkers.push(h);
  }

  // ---------- HUD (the same as the 3D street) ----------
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
      <ul><li data-g="tower">${icon("check")}<span>${esc(tl(C.things.tower.label))}</span></li><li data-g="salma" hidden>${icon("check")}<span>${esc(tl(C.next.goal))}</span></li><li data-g="sada" hidden>${icon("check")}<span>${esc(tl(C.after.goal))}</span></li><li data-g="route" hidden>${icon("check")}<span>${esc(tl(C.routeNext.goal))}</span></li><li data-g="record" hidden>${icon("check")}<span>${esc(tl(C.serviceNext.goal))}</span></li><li data-g="service" hidden>${icon("check")}<span>${esc(tl(C.service.next.goal))}</span></li><li data-g="maint" hidden>${icon("check")}<span>${esc(tl(C.maint.next.goal))}</span></li></ul></section>
    <button class="gm-guide" id="gm-guide" type="button" hidden><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3l7 9h-4.5v9h-5v-9H5z" fill="currentColor"/></svg><span></span></button>
    <p class="gm-help" id="gm-help">${esc(game.input.touch ? t("المس الطريق لتمشي · المس البرج لتدخله", "Tap the road to walk · tap the tower to go in") : t("WASD أو الأسهم للتحرك · انقر للمشي · E للدخول", "WASD / arrows or click to walk · E to enter"))}</p>
    <button type="button" class="gm-act" id="gm-act" hidden data-sfx="click"><span class="gm-act-i">${icon("hand")}</span><span class="gm-act-t"><small id="gm-act-k"></small><b id="gm-act-v"></b></span></button>
    <div class="gm-card" id="gm-card" hidden><small></small><b></b></div>
    <div class="gm-timer" id="gm-timer" hidden><small>${esc(tl(C.maint.timer))}</small><b>60</b></div>
    <div class="gm-svc" id="gm-svc" hidden aria-hidden="true"><span class="gm-svc-k">${esc(tl(C.service.inside))}</span><div class="gm-svc-scr"><i>F-40</i><p>${esc(tl(C.service.hook[1].lines[0]))}</p></div></div>`, "gm-room gm-street");
  const $ = (s) => L.querySelector(s);
  const paintObj = () => {
    $("[data-g=tower]").classList.toggle("ok", !!game.save.flag("street.tower"));
    const met = !!game.save.flag("story.salma"), li = $("[data-g=salma]");
    const heard = met && !!game.save.flag("story.sada"), l2 = $("[data-g=sada]");
    const route = heard && !!game.save.flag("story.route"), rec = route && !!game.save.flag("story.record");
    li.hidden = !met; li.classList.toggle("ok", heard); l2.hidden = !heard; l2.classList.toggle("ok", route);
    const done4 = rec && !!game.save.flag("story.service");
    const l3 = $("[data-g=route]"), l4 = $("[data-g=record]"), l5 = $("[data-g=service]"); l3.hidden = !route; l3.classList.toggle("ok", rec); l4.hidden = !rec; l4.classList.toggle("ok", done4); l5.hidden = !done4;
    const done5 = done4 && !!game.save.flag("story.maint"), l6 = $("[data-g=maint]"); l5.classList.toggle("ok", done5); l6.hidden = !done5;
    $("#gm-obj-t").textContent = tl(done5 ? C.maint.next.objective : done4 ? C.service.next.objective : rec ? C.serviceNext.objective : route ? C.routeNext.objective : heard ? C.after.objective : met ? C.next.objective : C.objective);
  };
  const refreshBal = () => { if (!game.member) { $("#gm-bal").textContent = "—"; return; } game.host.api("GET", "/api/mjt/me").then((m) => { $("#gm-bal").textContent = String(m.balance.mjt); }, () => { $("#gm-bal").textContent = "—"; }); };
  refreshBal(); paintObj(); game.missions?.paint();
  const goGuide = () => { const th = storyGoal(); if (th && canWalk()) { pending = null; guideTo(th); hideHelp(); game.audio.sfx("hover"); } };
  for (const g of ["salma", "route", "record", "service"]) $(`[data-g=${g}]`).addEventListener("click", goGuide);
  $("#gm-guide").addEventListener("click", goGuide);
  $("#gm-menu").addEventListener("click", () => openPause(game));
  game.input.on("pause", () => { if (game.scenes.name === "street" && !game.ui.modalOpen && !busy) openPause(game); });
  function card(k, v) { const c = $("#gm-card"); c.querySelector("small").textContent = k; c.querySelector("b").textContent = v; c.hidden = false; c.classList.remove("on"); void c.offsetWidth; c.classList.add("on"); setTimeout(() => { c.hidden = true; }, 3200); }

  // ---------- interaction (the same story flow as the 3D street) ----------
  let near = null, busy = false, inHall = false, helpGone = false, push = null;
  const showAct = (th) => { const a = $("#gm-act"); if (!th) { a.hidden = true; return; } $("#gm-act-k").textContent = tl(C.things[th.id].label); $("#gm-act-v").textContent = tl(th.id === "service" && winOpen() ? C.things.service.verb2 : C.things[th.id].verb); a.hidden = false; a.dataset.goal = th.id === "tower" ? "1" : ""; };
  const hideHelp = () => { if (helpGone) return; helpGone = true; $("#gm-help").classList.add("gone"); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const flash = (on) => game.root.classList.toggle("gm-flash-on", on);
  const turnTo = (h, x, z) => { h.face(x, z); };

  async function use(th) {
    if (busy) return; busy = true; showAct(null); player.walkTo(null); player.face(th.face.x, th.face.z);
    try {
      if (th.id === "tower") {
        if (!game.save.flag("story.salma")) await meetSalma();
        else if (game.save.flag("story.sada") && !game.save.flag("story.route")) { await sadaRoute(); return; }
        game.audio.sfx("open"); fx.towerDoor = 1;
        player.walkTo({ x: 0, z: GATE_Z + 0.6 });
        push = { x: 0, z: GATE_Z - 3 };
        await wait(900); game.audio.sfx("whoosh"); flash(true); await wait(380);
        if (!game.save.flag("street.tower")) { game.save.set({ flags: { "street.tower": true } }); game.audio.sfx("ping"); paintObj(); }
        game.missions?.complete("c1.tower"); // XP from the server only (a repeat grants nothing)
        game.save.flush();
        inHall = true; game.loop.pause(true);
        game.street.tower = openTower(game, { onClose: () => { game.street.tower = null; game.loop.pause(false); onStationClose(); } });
        await wait(250); flash(false);
        return;
      }
      if (th.id === "signal") { if (sigLive()) await meetSada(); return; }
      if (th.id === "market") { if (mkLive()) await meetNasser(); return; }
      if (th.id === "maint") { if (mtLive()) await usePanel(); return; }
      if (th.id === "service") { if (svcLive()) await enterService(); else if (winOpen()) await enterMaint(); else { game.audio.sfx("locked"); card(tl(C.things.service.label), t("الباب مقفل", "The door is locked")); } return; }
      if (th.id === "home") {
        game.audio.sfx("open"); game.scenes.reg.room?.().catch(() => { }); player.walkTo({ x: 0, z: HOME_Z - 0.5 });
        push = { x: 0, z: HOME_Z + 2 };
        await wait(700); game.audio.sfx("whoosh"); flash(true); await wait(320);
        leaving = true; game.save.set({ scene: "room", pos: null });
        await game.scenes.go("room", { from: "door", fade: 250, fadeIn: 600 }); flash(false);
        return;
      }
    } finally { if (!inHall) busy = false; }
  }
  // Season 1, «الإشارة»: Salma at the front desk, the key «40», what she knows of Yousuf
  async function meetSalma() {
    turnTo(salma, player.pos.x, player.pos.z); player.face(salma.pos.x, salma.pos.z);
    const names = { salma: tl(C.salmaName), narrator: tl(C.narrator) };
    for (const beat of C.salma) await game.ui.dialog(beat.lines.map((l) => fill(tl(l), { name })), names[beat.who] || "");
    game.save.set({ flags: { "story.salma": true } }); game.audio.sfx("ping"); paintObj();
    card(tl(C.next.card), tl(C.next.objective)); game.save.flush();
    game.ui.toast(esc(tl(C.next.hint)));
  }
  // «الإشارة الأولى»: the key wakes the dead terminal, Yousuf's recording, first contact with Sada
  async function meetSada() {
    player.face(sig.face.x, sig.face.z); game.audio.sfx("reveal");
    const names = { narrator: tl(C.narrator), yousuf: tl(C.yousufName), sada: tl(C.sadaName) };
    for (const beat of C.signal) await game.ui.dialog(beat.lines.map((l) => fill(tl(l), { name })), names[beat.who] || "");
    game.save.set({ flags: { "story.sada": true } }); game.audio.sfx("ping"); paintObj();
    game.missions?.complete("c1.signal");
    card(tl(C.after.card), tl(C.after.objective)); game.save.flush();
  }
  // Phase 3, «السوق السفلي»
  const names3 = () => ({ narrator: tl(C.narrator), sada: tl(C.sadaName), nasser: tl(C.nasserName), fragment: tl(C.fragmentName) });
  const play = async (beats) => { const n = names3(); for (const b of beats) await game.ui.dialog(b.lines.map((l) => fill(tl(l), { name })), n[b.who] || ""); };
  async function sadaRoute() {
    game.audio.sfx("reveal"); await play(C.route);
    game.save.set({ flags: { "story.route": true } }); game.audio.sfx("ping"); paintObj();
    card(tl(C.routeNext.card), tl(C.routeNext.objective)); game.save.flush();
  }
  async function meetNasser() {
    turnTo(nasser, player.pos.x, player.pos.z); player.face(nasser.pos.x, nasser.pos.z);
    await play(C.nasser);
    const ch = C.choice, i = await game.ui.choose(tl(ch.prompt), [{ label: tl(ch.key), hint: tl(ch.keyHint) }, { label: tl(ch.signal), hint: tl(ch.signalHint) }]);
    const way = i === 0 ? "key" : "signal";
    await play(way === "key" ? C.byKey : C.bySignal);
    await play(C.record);
    game.save.set({ flags: { "story.record": true, ["story.nasser." + way]: true } }); game.audio.sfx("ping"); paintObj();
    game.missions?.complete("c1.market");
    card(tl(C.title), tl(C.serviceNext.done)); game.save.flush();
    await wait(3400); card(tl(C.serviceNext.card), tl(C.serviceNext.objective));
  }
  // Phase 4, «المدخل المحظور»: the corridor is the same dimmed overlay as in 3D
  const svcEl = () => $("#gm-svc");
  async function enterService() {
    const S = C.service, n = { ...names3(), salma: tl(C.salmaName), reader: tl(S.readerName), screen: tl(S.screenName) };
    const say = async (beats) => { for (const b of beats) await game.ui.dialog(b.lines.map((l) => fill(tl(l), { name })), n[b.who] || ""); };
    player.face(svc.at.x + 0.95, GATE_Z);
    await say(S.reader.slice(0, 2));
    game.audio.sfx("scan"); fx.reader = "#ff3020"; fx.readerK = 1; fx.svcLight = 1.6; await wait(500);
    game.audio.sfx("locked"); await say(S.reader.slice(2));
    fx.reader = "#ffb020";
    salma.pos.set(svc.at.x - 0.2, 0, GATE_Z + 0.4); salma.heading = 0; turnTo(salma, player.pos.x, player.pos.z);
    game.audio.sfx("open"); fx.svcOpen = 1; fx.svcLight = 0.2;
    await say(S.salma);
    push = { x: svc.at.x, z: GATE_Z - 2 };
    await wait(800); game.audio.sfx("whoosh"); flash(true); await wait(320);
    const ov = svcEl(); ov.hidden = false; requestAnimationFrame(() => ov.classList.add("on")); await wait(200); flash(false);
    const ch = S.choice, i = await game.ui.choose(tl(ch.prompt), [{ label: tl(ch.knew), hint: tl(ch.knewHint) }, { label: tl(ch.floor), hint: tl(ch.floorHint) }]);
    const way = i === 0 ? "knew" : "floor";
    await say(way === "knew" ? S.byKnew : S.byFloor);
    await say(S.revoked);
    const ex = S.examine; await game.ui.choose(tl(ex.prompt), [{ label: tl(ex.go), hint: tl(ex.goHint) }]);
    game.audio.sfx("scan"); ov.classList.add("scan"); await wait(700);
    ov.classList.add("f40"); await say(S.found);
    ov.classList.add("msg"); game.audio.sfx("reveal"); await say(S.hook.slice(0, 2)); ov.classList.remove("msg");
    await say(S.hook.slice(2));
    game.save.set({ flags: { "story.service": true, ["story.salma2." + way]: true } }); game.audio.sfx("ping");
    game.missions?.complete("c1.service");
    game.save.flush();
    flash(true); await wait(300); ov.classList.remove("on", "scan", "f40"); ov.hidden = true;
    push = null; player.walkTo(null); player.pos.set(svc.at.x, 0, svc.at.z + 0.6); player.heading = 0;
    fx.svcOpen = 0; fx.reader = "#ffb020"; fx.readerK = 0.3;
    salma.pos.set(1.9, 0, GATE_Z + 1.1); salma.heading = 0;
    await wait(250); flash(false); paintObj();
    card(tl(C.title), tl(S.next.done)); await wait(3400); card(tl(S.next.card), tl(S.next.objective));
  }
  // Phase 5, «وصول الطابق الأربعين»: evidence at the old panel, the route code, the key's bit, a 60-second window to the
  // service door, the old log against the official one, a message to the player. No new server mission (XP) here.
  const WIN_S = 60;
  const sayM = async (beats) => { const n = { ...names3(), panel: tl(C.maint.panelName), official: tl(C.maint.officialName), old: tl(C.maint.oldName), screen: tl(C.service.screenName) };
    for (const b of beats) await game.ui.dialog(b.lines.map((l) => fill(tl(l), { name })), n[b.who] || ""); };
  async function usePanel() {
    const M = C.maint; player.face(mt.face.x, mt.face.z); fx.mtScreen = 1.2; game.audio.sfx("scan");
    if (!game.save.flag("story.maintCode")) {
      await sayM(M.open);
      const seen = new Set();
      for (;;) {
        const left = M.evidence.items.filter((e) => !seen.has(e.id));
        const opts = left.map((e) => ({ label: tl(e.label), hint: tl(e.hint) }));
        if (seen.size >= 2) opts.push({ label: tl(M.evidence.done), hint: tl(M.evidence.doneHint) });
        if (!opts.length) break;
        const i = await game.ui.choose(tl(M.evidence.prompt), opts);
        if (i >= left.length) break;
        const e = left[i]; seen.add(e.id); game.audio.sfx("type");
        await game.ui.dialog(e.lines.map((l) => tl(l)), tl(C.narrator));
      }
      game.save.set({ flags: { "story.maintEv": [...seen].join(",") } });
      for (;;) {
        const i = await game.ui.choose(tl(M.code.prompt), M.code.opts.map((o) => ({ label: tl(o.label), hint: tl(o.hint) })));
        if (M.code.opts[i].id === "f40") break;
        game.audio.sfx("locked"); await game.ui.dialog([tl(M.code.wrong)], tl(M.panelName));
      }
      game.save.set({ flags: { "story.maintCode": true } }); game.save.flush(); game.audio.sfx("confirm");
    }
    for (;;) {
      const i = await game.ui.choose(tl(M.confirm.prompt), M.confirm.opts.map((o) => ({ label: tl(o.label), hint: tl(o.hint) })));
      if (M.confirm.opts[i].id === "key") break;
      game.audio.sfx("locked"); await game.ui.dialog([tl(M.confirm.wrong)], tl(M.panelName));
    }
    game.audio.sfx("ping"); await sayM(M.granted);
    win = { until: performance.now() + WIN_S * 1000 }; $("#gm-timer").hidden = false; paintTimer();
    card(tl(M.timer), String(WIN_S) + t(" ثانية", " seconds"));
  }
  const paintTimer = () => { if (!win) return; const left = Math.max(0, Math.ceil((win.until - performance.now()) / 1000)); const b = $("#gm-timer b"); if (b.textContent !== String(left)) b.textContent = String(left); };
  let winT = 0;
  const stepWindow = () => {
    const now = performance.now(), dt = winT ? now - winT : 0; winT = now;
    if (!win) return;
    if (busy || game.ui.modalOpen) { win.until += dt; return; } // the clock holds while a dialogue or a choice is up
    paintTimer();
    if (now >= win.until) { win = null; $("#gm-timer").hidden = true; fx.mtScreen = 0.08; game.audio.sfx("locked"); game.ui.toast(esc(tl(C.maint.expired))); }
  };
  async function enterMaint() {
    const M = C.maint; $("#gm-timer").hidden = true;
    player.face(svc.at.x + 0.95, GATE_Z);
    fx.reader = "#3dff80"; game.audio.sfx("open"); fx.svcOpen = 1;
    push = { x: svc.at.x, z: GATE_Z - 2 };
    await wait(800); game.audio.sfx("whoosh"); flash(true); await wait(320);
    const ov = svcEl(); ov.querySelector(".gm-svc-k").textContent = tl(M.inside); ov.hidden = false; requestAnimationFrame(() => ov.classList.add("on")); await wait(200); flash(false);
    await sayM(M.terminal);
    await game.ui.choose(tl(M.look.prompt), [{ label: tl(M.look.go), hint: tl(M.look.goHint) }]);
    game.audio.sfx("scan"); ov.classList.add("scan", "logs"); await wait(700);
    await sayM(M.found);
    ov.classList.remove("logs"); ov.querySelector(".gm-svc-scr p").textContent = fill(tl(M.hook[0].lines[0]), { name });
    ov.classList.add("msg"); game.audio.sfx("reveal");
    await sayM(M.hook.slice(0, 1)); ov.classList.remove("msg"); await sayM(M.hook.slice(1));
    game.save.set({ flags: { "story.maint": true } }); game.audio.sfx("ping"); game.save.flush(); win = null;
    flash(true); await wait(300); ov.classList.remove("on", "scan"); ov.hidden = true;
    ov.querySelector(".gm-svc-k").textContent = tl(C.service.inside); ov.querySelector(".gm-svc-scr p").textContent = tl(C.service.hook[1].lines[0]);
    push = null; player.walkTo(null); player.pos.set(svc.at.x, 0, svc.at.z + 0.6); player.heading = 0;
    fx.svcOpen = 0; fx.reader = "#ffb020"; fx.mtScreen = 0.08;
    await wait(250); flash(false); paintObj();
    card(tl(C.title), tl(M.next.done)); await wait(3400); card(tl(M.next.card), tl(M.next.objective));
  }
  const onStationClose = () => {
    if (game.scenes.name !== "street") return;
    refreshBal(); push = null; fx.towerDoor = 0; busy = false; inHall = false; flash(false);
    player.walkTo(null); player.pos.set(0, 0, GATE_Z + 2.2); player.heading = 0;
    card(tl(C.things.tower.label), t("عدت إلى الشارع", "Back on the street"));
  };
  game.bus.on("station-closed", onStationClose);
  $("#gm-act").addEventListener("click", () => { if (near) use(near); });
  game.input.on("action", () => { if (game.scenes.name === "street" && near && !busy && !game.ui.modalOpen) use(near); });
  let pending = null, via = null;
  const canWalk = () => !busy && !game.ui.modalOpen && game.scenes.name === "street";
  function walk(x, z) {
    if (!canWalk()) return false;
    const b = world.bounds; pending = null; via = null;
    player.walkTo({ x: clamp(x, b.minX + 0.4, b.maxX - 0.4), z: clamp(z, b.minZ + 0.4, b.maxZ - 0.4) });
    hideHelp(); return true;
  }
  const hitThing = (p) => things.find((th) => liveOf(th) && (th.hit ? Math.hypot(p.x - th.hit.x, p.z - th.hit.z) < th.hit.r || (Math.abs(p.x) < 7 && p.z < GATE_Z && p.z > GATE_Z - 14) : Math.hypot(p.x - th.mark.x, p.z - (th.mark.z - th.mark.y)) < 0.9 || Math.hypot(p.x - th.face.x, p.z - th.face.z) < 1.1));
  game.input.on("tap", (n) => {
    if (!canWalk()) return;
    const p = view.toWorld(n.x, n.y), th = hitThing(p);
    if (th) { via = null; pending = th; player.walkTo(th.at); hideHelp(); } else walk(p.x, p.z);
  });
  // the guide walks down the clear middle of the road first, then across to the spot
  function guideTo(th) { via = th.at; player.walkTo({ x: 0, z: th.at.z }); }
  player.onArrive = () => { if (via) { const v = via; via = null; player.walkTo(v); return; } if (pending) { const th = pending; pending = null; use(th); } };

  // ---------- drawing ----------
  const c = view.ctx, v = view;
  const dark = (a) => { c.fillStyle = `rgba(6,6,20,${a})`; c.fillRect(0, 0, v.W, v.H); };
  function drawBlock(b) {
    const x0 = b.s < 0 ? -WALK - 13 : WALK, x1 = b.s < 0 ? -WALK : WALK + 13, z0 = b.z0, z1 = b.z1;
    if (!v.onScreen((x0 + x1) / 2, (z0 + z1) / 2, 12)) return;
    const X0 = v.sx(x0), X1 = v.sx(x1), Y0 = v.sy(z0), Y1 = v.sy(z1), face = 1.6 * PPM;
    // the roof, then the south face of the block (3/4 view), then the shopfront strip on the pavement side
    c.fillStyle = b.roof; c.fillRect(X0, Y0 - face, X1 - X0, Y1 - Y0);
    c.fillStyle = "rgba(255,255,255,.05)"; c.fillRect(X0, Y0 - face, X1 - X0, 1);
    const RR = rng(b.seed);
    for (let i = 0; i < 4; i++) { const ux = X0 + 6 + RR() * (X1 - X0 - 20), uy = Y0 - face + 4 + RR() * Math.max(1, Y1 - Y0 - 16); c.fillStyle = "#2c2f48"; c.fillRect(ux | 0, uy | 0, 10, 7); c.fillStyle = "#16182a"; c.fillRect((ux + 2) | 0, (uy + 2) | 0, 6, 3); }
    if (RR() < 0.5) { const ax = X0 + 10 + RR() * (X1 - X0 - 20), ay = Y0 - face + 6; c.fillStyle = "#3a3d58"; c.fillRect(ax | 0, ay | 0, 1, 8); c.fillStyle = Math.sin(performance.now() / 300 + b.seed) > 0 ? "#ff4060" : "#5a1020"; c.fillRect((ax - 1) | 0, (ay - 1) | 0, 3, 2); }
    // the south face with windows
    c.fillStyle = "#14152a"; c.fillRect(X0, Y1 - face, X1 - X0, face);
    for (let wy = Y1 - face + 3; wy < Y1 - 4; wy += 5) for (let wx = X0 + 3; wx < X1 - 3; wx += 5) { const on = !b.dark && RR() < 0.55; c.fillStyle = on ? (RR() < 0.7 ? "#ffcf6a" : "#9fe8ff") : "#1f2140"; c.globalAlpha = on ? 0.55 + RR() * 0.4 : 1; c.fillRect(wx, wy, 3, 2); c.globalAlpha = 1; }
    // the neon edge and the shopfront along the pavement
    const ex = b.s < 0 ? X1 - 2 : X0;
    c.fillStyle = b.dark ? "#2a2c40" : b.hue; c.fillRect(ex, Y0 - face, 2, Y1 - Y0);
    if (!b.dark) {
      const flick = Math.sin(performance.now() / 90 + b.seed) > -0.92 ? 1 : 0.3;
      glow(c, ex + (b.s < 0 ? 3 : -1), (Y0 + Y1) / 2 - face / 2, Math.min(42, (Y1 - Y0) / 1.3), b.hue, 0.28 * flick);
      const sx = b.s < 0 ? X1 - 4 - textW(b.sign) : X0 + 4, sy = (Y0 + Y1) / 2 - face - 2;
      c.fillStyle = "#0b0a14"; c.fillRect(sx - 2, sy - 2, textW(b.sign) + 4, 9); text(c, b.sign, sx, sy, b.hue); c.globalAlpha = flick; glow(c, sx + textW(b.sign) / 2, sy + 2, 12, b.hue, 0.5); c.globalAlpha = 1;
    }
  }
  function drawTower(time) {
    const cx = v.sx(0), base = v.sy(GATE_Z), pod = v.sy(GATE_Z, 4.2), top = v.sy(GATE_Z, 34);
    if (base < -10 || top > v.H + 10) return;
    // the wings: dark glass either side, rows of cyan windows
    const wx0 = v.sx(-7.5), wx1 = v.sx(7.5), wt = v.sy(GATE_Z, 9);
    c.fillStyle = "#121428"; c.fillRect(wx0, wt, wx1 - wx0, pod - wt);
    for (let y = wt + 3; y < pod - 2; y += 5) for (let x = wx0 + 3; x < wx1 - 3; x += 4) { if (Math.abs(x - cx) < 4.6 * PPM) continue; c.fillStyle = (x * 7 + y * 3) % 11 < 4 ? "#2fe6ff" : "#1c2a48"; c.globalAlpha = 0.7; c.fillRect(x, y, 2, 2); c.globalAlpha = 1; }
    // the shaft: gold glass tapering from 9 m to a needle, mullions and bands
    for (let y = Math.max(top, -2); y < pod; y++) {
      const f = (pod - y) / (pod - top), half = Math.max(2, Math.round(4.6 * PPM * (1 - f * 0.78)));
      const g = f < 0.3 ? "#9a6a18" : f < 0.7 ? "#b8801e" : "#d89a2a";
      c.fillStyle = g; c.fillRect(cx - half, y, half * 2, 1);
      c.fillStyle = "#5a3a0c"; c.fillRect(cx - half, y, 1, 1); c.fillRect(cx + half - 1, y, 1, 1);
      if ((pod - y) % 8 === 0) { c.fillStyle = "#ffcf6a"; c.fillRect(cx - half, y, half * 2, 1); }
      else for (let m = -half + 6; m < half - 2; m += 7) { c.fillStyle = "#6a440e"; c.fillRect(cx + m, y, 1, 1); }
    }
    for (let i = 0; i < 26; i++) { const R2 = rng(i * 31 + 7), yy = pod - R2() * (pod - top) * 0.8, f = (pod - yy) / (pod - top), half = 4.6 * PPM * (1 - f * 0.78), xx = cx - half + 3 + R2() * (half * 2 - 6); c.fillStyle = "#fff2c4"; c.globalAlpha = 0.4 + Math.max(0, Math.sin(time * 1.5 + i)) * 0.5; c.fillRect(xx | 0, yy | 0, 2, 1); c.globalAlpha = 1; }
    c.fillStyle = "#ffe39a"; c.fillRect(cx, top - 24, 1, 24); glow(c, cx, top - 24, 9, "#ffe39a", 0.8 + Math.sin(time * 5) * 0.2);
    // the coin emblem on the shaft
    const ry = v.sy(GATE_Z, 11), pulse = 0.8 + Math.sin(time * 2) * 0.2;
    glow(c, cx, ry, 64, "rgba(255,200,80,.55)", pulse);
    c.fillStyle = "#6a3c08"; c.beginPath(); c.arc(cx, ry, 17, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#ffc23d"; c.beginPath(); c.arc(cx, ry, 15, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#e0a22c"; c.beginPath(); c.arc(cx, ry, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#ffe39a"; c.fillRect(cx - 9, ry - 11, 4, 2);
    text(c, "MJT", cx - 11, ry - 5, "#5a3008", 2);
    // the podium: dark stone, a gold trim, the sign, the doors
    c.fillStyle = "#1c1824"; c.fillRect(wx0, pod, wx1 - wx0, base - pod);
    c.fillStyle = "#ffc23d"; c.fillRect(wx0, pod, wx1 - wx0, 2); c.fillStyle = "#7a5a1c"; c.fillRect(wx0, pod + 2, wx1 - wx0, 1);
    for (let x = wx0 + 6; x < wx1 - 4; x += 10) { if (Math.abs(x - cx) < 2.4 * PPM) continue; c.fillStyle = "#2a2434"; c.fillRect(x, pod + 6, 2, base - pod - 6); }
    const sg = "MJT TOWER", sw2 = textW(sg) + 6; c.fillStyle = "#0b0a14"; c.fillRect(cx - sw2 / 2, pod + 5, sw2, 9); text(c, sg, cx - textW(sg) / 2, pod + 7, "#ffe39a"); glow(c, cx, pod + 9, 26, "rgba(255,210,120,.6)", 0.5);
    const dw = 3 * PPM, dh = 2.6 * PPM, dx = cx - dw / 2, dy = base - dh, op = fx.towerDoor;
    c.fillStyle = "#0b0a14"; c.fillRect(dx - 3, dy - 3, dw + 6, dh + 3);
    c.fillStyle = op ? "#fff2c4" : "#ffcf6a"; c.fillRect(dx, dy, dw, dh); c.fillStyle = "#c8962c"; c.fillRect(dx + dw / 2, dy, 1, dh);
    if (!op) { c.fillStyle = "rgba(90,58,12,.5)"; c.fillRect(dx, dy, dw / 2 - 1, dh); c.fillRect(dx + dw / 2 + 1, dy, dw / 2 - 1, dh); }
    glow(c, cx, base + 4, 40, "rgba(255,210,120,.8)", 0.55 + op * 0.4);
  }
  function drawService(time) {
    const ax = svc.at.x, X0 = v.sx(ax - 1.4), X1 = v.sx(ax + 1.4), base = v.sy(GATE_Z), top = v.sy(GATE_Z, 3.6);
    c.fillStyle = "#26282e"; c.fillRect(X0, top - 10, X1 - X0, 10); // the annex roof
    c.fillStyle = "#33363e"; c.fillRect(X0, top, X1 - X0, base - top);
    c.fillStyle = "#ffb020"; c.fillRect(X0, v.sy(GATE_Z, 3.0), X1 - X0, 2);
    for (let x = X0; x < X1; x += 4) { c.fillStyle = "#1a1a1a"; c.fillRect(x, v.sy(GATE_Z, 3.0), 2, 2); }
    const dX0 = v.sx(ax - 0.65), dW = v.sx(ax + 0.65) - dX0, dTop = v.sy(GATE_Z, 2.3);
    c.fillStyle = "#0b0a14"; c.fillRect(dX0, dTop, dW, base - dTop);
    if (fx.svcOpen) { c.fillStyle = "#5a4a20"; c.fillRect(dX0, dTop, dW, base - dTop); glow(c, dX0 + dW / 2, base - 6, 18, "rgba(255,190,90,.8)", 0.7); }
    c.fillStyle = "#565a64"; c.fillRect(dX0 + (fx.svcOpen ? dW - 3 : 0), dTop, fx.svcOpen ? 3 : dW, base - dTop);
    const lx = v.sx(ax), ly = v.sy(GATE_Z, 2.65);
    c.fillStyle = fx.svcLight > 1 ? "#ff3030" : "#5a1010"; c.fillRect(lx - 4, ly, 8, 2); if (fx.svcLight > 1) glow(c, lx, ly, 16, "#ff3030", 0.8 + Math.sin(time * 12) * 0.2);
    const rx = v.sx(ax + 0.95), ry = v.sy(GATE_Z, 1.3), live = svcLive() || winOpen();
    const k = busy ? fx.readerK : live ? 0.6 + Math.max(0, Math.sin(time * 4.2)) * 0.9 : 0.3;
    c.fillStyle = fx.reader; c.fillRect(rx - 1, ry, 3, 4); glow(c, rx, ry + 2, 9, fx.reader, Math.min(1, k * 0.6));
    text(c, "F", X0 + 3, top + 3, "#8a8e98");
  }
  function drawMaint(time) {
    const X = mt.at.x, X0 = v.sx(X - 0.6), X1 = v.sx(X + 0.6), base = v.sy(GATE_Z - 0.3), top = v.sy(GATE_Z - 0.3, 2.0);
    c.fillStyle = "#24221e"; c.fillRect(X0, v.sy(GATE_Z - 0.8, 2.0), X1 - X0, v.sy(GATE_Z - 0.3, 2.0) - v.sy(GATE_Z - 0.8, 2.0));
    c.fillStyle = "#33302a"; c.fillRect(X0, top, X1 - X0, base - top);
    c.fillStyle = "#4a463c"; c.fillRect(X0, top, X1 - X0, 1);
    const L = mtLive(), k = busy ? fx.mtScreen : L ? 0.4 + Math.max(0, Math.sin(time * 3.3)) * 0.8 : winOpen() ? 1.2 : 0.08;
    const sx = v.sx(X - 0.35), sw = v.sx(X + 0.35) - sx, sy = v.sy(GATE_Z - 0.3, 1.65);
    c.fillStyle = k > 0.3 ? "#ffb020" : "#3a2a10"; c.fillRect(sx, sy, sw, 7);
    if (k > 0.3) { c.fillStyle = "#3a2a08"; for (let i = 0; i < 3; i++) c.fillRect(sx + 1, sy + 1 + i * 2, Math.round(sw * (0.4 + ((i * 37 + Math.floor(time * 2)) % 6) / 10)), 1); glow(c, sx + sw / 2, sy + 4, 16, "#ffb020", Math.min(0.9, k * 0.6)); }
    c.fillStyle = "#1a1814"; for (let y = sy + 10; y < base - 2; y += 3) c.fillRect(X0 + 2, y, X1 - X0 - 4, 1);
  }
  function drawSignal(time) {
    const X = sig.face.x, X0 = v.sx(X - 0.25), X1 = v.sx(X + 0.25), z = midZ, base = v.sy(z + 0.45), top = v.sy(z + 0.45, 2.2);
    c.fillStyle = "#0e1016"; c.fillRect(X0, v.sy(z - 0.45, 2.2), X1 - X0, v.sy(z + 0.45, 2.2) - v.sy(z - 0.45, 2.2));
    c.fillStyle = "#1a1d26"; c.fillRect(X0, top, X1 - X0, base - top);
    const live = sigLive(), k = live ? 0.55 + Math.max(0, Math.sin(time * 9.0) * Math.sin(time * 2.3)) * 1.4 : 0.05;
    const sx = X0 + 1, sw = X1 - X0 - 2, sy = v.sy(z + 0.45, 1.9);
    c.fillStyle = k > 0.3 ? "#2fe6ff" : "#0d2a34"; c.fillRect(sx, sy, sw, 10);
    if (k > 0.3) { text(c, "40", sx + Math.max(0, (sw - 7) / 2), sy + 3, "#04121f"); glow(c, sx + sw / 2, sy + 5, 22, "#2fe6ff", Math.min(1, k * 0.5)); }
  }
  function drawMarket(time) {
    const X = mk.face.x, Z = midZ - 6, X0 = v.sx(X - 0.65), X1 = v.sx(X + 0.65), Y0 = v.sy(Z - 1.1), Y1 = v.sy(Z + 1.1);
    c.fillStyle = "#020205"; c.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    for (let y = Y0 + 3; y < Y1; y += 4) { c.fillStyle = `rgba(80,60,90,${0.2 + (y - Y0) / (Y1 - Y0) * 0.5})`; c.fillRect(X0 + 1, y, X1 - X0 - 2, 1); }
    c.fillStyle = "#8a6a3a"; c.fillRect(X0 - 1, Y0 - 6, 1, Y1 - Y0 + 6); c.fillRect(X1, Y0 - 6, 1, Y1 - Y0 + 6); c.fillRect(X0 - 1, Y0 - 6, X1 - X0 + 2, 1);
    const live = mkLive(), pk = live ? 1.1 + Math.sin(time * 3.1) * 0.35 : 0.5;
    const px0 = v.sx(X + 0.8), py = v.sy(Z + 1.0, 2.8);
    c.fillStyle = "#5a4a3a"; c.fillRect(px0, py, 1, v.sy(Z + 1.0) - py);
    c.fillStyle = "#0b0a14"; c.fillRect(px0 - 14, py - 1, 16, 9); text(c, "SOUQ", px0 - 13, py + 1, pk > 0.8 ? "#ff3fb4" : "#7a2a5a");
    glow(c, px0 - 6, py + 3, 22, "#ff3fb4", Math.min(1, pk * 0.35));
    // the stall: a crate and a lamp of old parts
    const cx0 = v.sx(X - 0.2), cy = v.sy(Z + 2.6, 0.6);
    c.fillStyle = "#5a3a1c"; c.fillRect(cx0, cy, v.sx(X + 0.6) - cx0, v.sy(Z + 2.6) - cy); c.fillStyle = "#7a5430"; c.fillRect(cx0, cy, v.sx(X + 0.6) - cx0, 1);
    c.fillStyle = "#2fe6ff"; c.fillRect(cx0 + 3, cy - 2, 2, 2); c.fillStyle = "#ffc23d"; c.fillRect(cx0 + 7, cy - 1, 2, 1);
    glow(c, cx0 + 6, cy, 14, "rgba(255,190,110,.9)", 0.5);
  }
  const drawLamp = (l, time) => {
    const x = v.sx(l.x), y = v.sy(l.z), hy = v.sy(l.z, 4.2);
    c.fillStyle = "#2a2c3a"; c.fillRect(x, hy, 1, y - hy); c.fillStyle = "#3a3d50"; c.fillRect(x - 1, y - 2, 3, 2);
    const arm = l.x < 0 ? 1 : -1; c.fillStyle = "#2a2c3a"; c.fillRect(Math.min(x, x + arm * 6), hy, 7, 1);
    c.fillStyle = "#ffe0a0"; c.fillRect(x + arm * 6 - 1, hy + 1, 3, 1); glow(c, x + arm * 6, hy + 2, 7, "#ffe0a0", 0.9);
    void time;
  };
  const drawLampPool = (l) => glow(c, v.sx(l.x + (l.x < 0 ? 0.4 : -0.4)), v.sy(l.z), 34, "rgba(255,190,110,.55)", 0.8);
  const drawTree = (tr, time) => {
    const x = v.sx(tr.x), y = v.sy(tr.z), sw = Math.round(Math.sin(time * 1.1 + tr.z) * 1);
    c.fillStyle = "#3a3448"; c.fillRect(x - 8, y - 8, 16, 9); c.fillStyle = "#4a4460"; c.fillRect(x - 8, y - 8, 16, 1);
    c.fillStyle = "#3a2a1a"; c.fillRect(x - 1, y - 18, 2, 10);
    c.fillStyle = "#0f3a2c"; c.beginPath(); c.arc(x + sw, y - 24, 11, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#1a5a40"; c.beginPath(); c.arc(x - 3 + sw, y - 27, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#2a8a5a"; c.fillRect(x - 5 + sw, y - 31, 3, 2); c.fillRect(x + 2 + sw, y - 28, 2, 2);
  };
  const drawBench = (b) => { const x = v.sx(b.x), y0 = v.sy(b.z - 0.8, 0.5), y1 = v.sy(b.z + 0.8, 0.5); c.fillStyle = "#4a3a2a"; c.fillRect(x - 4, y0, 8, y1 - y0); c.fillStyle = "#6a5236"; for (let y = y0; y < y1; y += 3) c.fillRect(x - 4, y, 8, 1); c.fillStyle = "#1a1a24"; c.fillRect(x - 4, y1, 8, 3); };
  const drawCarSide = (k) => { // a car on the cross street, seen from above, driving across the screen
    const x = v.sx(k.x), y = v.sy(k.z), w = 38, h = 18, x0 = x - w / 2, y0 = y - h / 2;
    c.fillStyle = "rgba(0,0,0,.45)"; c.fillRect(x0 + 1, y0 + 3, w, h);
    c.fillStyle = k.col; c.fillRect(x0, y0, w, h); c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(x0, y0 + h - 3, w, 3);
    c.fillStyle = "#0b1224"; c.fillRect(x0 + 8, y0 + 2, 7, h - 4); c.fillRect(x0 + 24, y0 + 2, 6, h - 4); c.fillStyle = "rgba(255,255,255,.25)"; c.fillRect(x0 + 15, y0 + 2, 9, h - 4);
    const f = k.dir > 0 ? x0 + w - 1 : x0, b = k.dir > 0 ? x0 : x0 + w - 1;
    c.fillStyle = "#fff2c4"; c.fillRect(f, y0 + 2, 1, 3); c.fillRect(f, y0 + h - 5, 1, 3); glow(c, f + k.dir * 16, y, 24, "rgba(255,240,200,.7)", 0.6);
    c.fillStyle = "#ff3040"; c.fillRect(b, y0 + 2, 1, 3); c.fillRect(b, y0 + h - 5, 1, 3);
  };
  const drawCar = (k, time, moving) => {
    const x = v.sx(k.x), y = v.sy(k.z), w = 18, h = 38, x0 = x - w / 2, y0 = y - h / 2;
    c.fillStyle = "rgba(0,0,0,.45)"; c.fillRect(x0 + 1, y0 + 3, w, h);
    c.fillStyle = k.col; c.fillRect(x0, y0, w, h); c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(x0, y0 + h - 4, w, 4);
    c.fillStyle = "#0b1224"; c.fillRect(x0 + 2, y0 + 8, w - 4, 7); c.fillRect(x0 + 2, y0 + 25, w - 4, 6);
    c.fillStyle = "rgba(255,255,255,.25)"; c.fillRect(x0 + 2, y0 + 16, w - 4, 8);
    const front = moving && k.dir < 0 ? y0 : y0 + h - 1, back = moving && k.dir < 0 ? y0 + h - 1 : y0;
    if (moving) { c.fillStyle = "#fff2c4"; c.fillRect(x0 + 2, front, 3, 1); c.fillRect(x0 + w - 5, front, 3, 1); glow(c, x, front + (k.dir < 0 ? -14 : 14), 22, "rgba(255,240,200,.7)", 0.6); c.fillStyle = "#ff3040"; c.fillRect(x0 + 2, back, 3, 1); c.fillRect(x0 + w - 5, back, 3, 1); }
    void time;
  };
  function drawHome() {
    const X0 = v.sx(-WALK - 13), X1 = v.sx(WALK + 13), Y0 = v.sy(HOME_Z), Y1 = v.sy(HOME_Z + 14);
    c.fillStyle = "#191a2c"; c.fillRect(X0, Y0, X1 - X0, Y1 - Y0); c.fillStyle = "#2a2c44"; c.fillRect(X0, Y0, X1 - X0, 2);
    // the lit doorway with its canopy
    const dx0 = v.sx(-1.3), dx1 = v.sx(1.3);
    c.fillStyle = "#3a2e1a"; c.fillRect(dx0 - 4, Y0 - 4, dx1 - dx0 + 8, 6); c.fillStyle = "#ffc23d"; c.fillRect(dx0 - 4, Y0 + 1, dx1 - dx0 + 8, 1);
    glow(c, (dx0 + dx1) / 2, Y0 - 4, 36, "rgba(255,200,120,.75)", 0.75);
  }
  function drawGuide(time, hide) {
    const g = hide ? null : storyGoal(), el = $("#gm-guide");
    const gx = g ? g.at.x - player.pos.x : 0, gz = g ? g.at.z - player.pos.z : 0, gd = Math.hypot(gx, gz);
    const on = !!g && gd > 2.2; if (el.hidden === on) el.hidden = !on;
    if (on) {
      el.firstElementChild.style.transform = `rotate(${Math.atan2(gx, -gz).toFixed(3)}rad)`;
      const k = tl(C.things[g.id].label) + " · " + Math.round(gd) + t(" م", " m"); if (el.lastElementChild.textContent !== k) el.lastElementChild.textContent = k;
    }
    if (!g) return;
    const col = g === mk ? "#ff3fb4" : g === svc || g === mt ? "#ffb020" : "#2fe6ff";
    // a light beam over the spot and a pulsing trail on the ground
    const bx = v.sx(g.mark.x), by = v.sy(g.mark.z);
    c.globalCompositeOperation = "lighter"; c.globalAlpha = 0.18 + Math.sin(time * 2.4) * 0.06; c.fillStyle = col; c.fillRect(bx - 3, 0, 7, by); c.fillRect(bx - 1, 0, 3, by); c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
    if (gd > 2.4) for (let i = 0; i < 14; i++) {
      const at = 1.1 + i * 1.15; if (at > gd - 0.9) break;
      const x = player.pos.x + (gx / gd) * at, z = player.pos.z + (gz / gd) * at, a = 0.18 + 0.7 * Math.max(0, Math.sin(time * 4 - i * 0.55));
      c.globalAlpha = a; c.fillStyle = col; c.fillRect(v.sx(x) - 1, v.sy(z) - 1, 3, 2); c.globalAlpha = 1;
    }
  }
  // dust in the lamplight
  const motes = Array.from({ length: 40 }, () => ({ x: (R() - 0.5) * 24, z: (R() - 0.5) * 30, s: 0.2 + R() * 0.5 }));

  // ---------- camera: above the player, a little ahead toward the tower; the intro sweeps down from the tower ----------
  const viewM = () => ({ w: v.W / PPM, h: v.H / PPM });
  const goalCam = () => {
    const m = viewM();
    let z = player.pos.z - m.h * 0.14; z = Math.min(z, HOME_Z + 5 - m.h / 2); z = Math.max(z, CORE_Z - 2 - m.h * 0.1);
    const xr = Math.max(0, WALK + 4 - m.w / 2);
    return { x: clamp(player.pos.x * 0.7, -xr, xr), z };
  };
  let intro = !back ? { k: 0 } : null; const gaze = { t: -1, n: 0 };
  { const g = goalCam(); v.cam.x = g.x; v.cam.z = intro ? GATE_Z - 6 : g.z; }
  const startGaze = () => { if (gaze.t >= 0) return false; gaze.t = 0; gaze.n++; return true; };

  game.street = { lookUp: () => (busy || push || intro ? false : startGaze()), use: (id) => { const th = byId(id); if (th) return use(th); }, walk, player, gate: GATE_Z, home: HOME_Z, engine: "pixel", state: () => ({ busy, intro: !!intro, target: player.target && { x: player.target.x, z: player.target.z }, locked: player.locked, near: near && near.id, gaze: { g: gaze.t >= 0 ? 1 : 0, on: gaze.t >= 0, n: gaze.n }, salma: !!game.save.flag("story.salma"), sada: !!game.save.flag("story.sada"), signal: sigLive(), sigAt: { x: sig.at.x, z: sig.at.z }, route: !!game.save.flag("story.route"), record: !!game.save.flag("story.record"), market: mkLive(), guide: storyGoal()?.id || null, mkAt: { x: mk.at.x, z: mk.at.z }, service: svcLive(), served: !!game.save.flag("story.service"), svcAt: { x: svc.at.x, z: svc.at.z }, inside: !!svcEl() && !svcEl().hidden, maint: mtLive(), mtAt: { x: mt.at.x, z: mt.at.z }, win: winOpen() ? Math.max(0, Math.ceil((win.until - performance.now()) / 1000)) : 0, maintDone: !!game.save.flag("story.maint") }) }; // the game's own tests
  game.canvas.style.visibility = "hidden";

  return {
    scene: null, camera: null, engine: "pixel",
    enter() {
      v.resize(); game.audio.music("room"); game.audio.ambient("city"); saveSpot();
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
      if (Math.abs(mv.x) + Math.abs(mv.y) > 0.1) { hideHelp(); if (gaze.t >= 0) gaze.t = Math.max(gaze.t, 3.2); }
      player.update(dt, busy ? STILL : mv, 0, world);
      salma.update(dt, STILL, 0, null); nasser.update(dt, STILL, 0, null);
      stepWindow();
      let best = null, bd = 1.6;
      for (const th of things) {
        const live = liveOf(th);
        const d = live ? Math.hypot(th.at.x - player.pos.x, th.at.z - player.pos.z) : 99; if (d < bd) { bd = d; best = th; }
      }
      for (const th of things) th.a += ((th === best ? 1 : 0) - th.a) * Math.min(1, dt * 8);
      if (best !== near) { near = best; if (!busy) { showAct(near); if (near) game.audio.sfx("hover"); } }
      if (busy && !$("#gm-act").hidden) showAct(null);
      for (const h of walkers) {
        const dp = Math.hypot(h.pos.x - player.pos.x, h.pos.z - player.pos.z);
        if (h.pause > 0) h.pause -= dt;
        if (dp < 1.5) { h.walkTo(null); h.face(player.pos.x, player.pos.z); h.pause = 0.8; }
        else if (h.pause <= 0 && !h.target) { const zz = h.dir < 0 ? GATE_Z + 7 : HOME_Z - 2; h.walkTo({ x: h.lane, z: zz }); h.onArrive = () => { h.dir = -h.dir; h.pause = 1 + Math.random() * 2; }; }
        h.update(dt, STILL, 0, null);
      }
      for (const k of cars) {
        const ahead = (player.pos.x - k.x) * k.dir, block = Math.abs(player.pos.z - k.z) < 1.4 && ahead > 0 && ahead < 4.5;
        const ahead2 = cars.some((o) => o !== k && o.dir === k.dir && Math.abs(o.z - k.z) < 0.5 && (o.x - k.x) * k.dir > 0 && (o.x - k.x) * k.dir < 4);
        k.v += ((block || ahead2 ? 0 : 6) - k.v) * Math.min(1, dt * (block || ahead2 ? 4 : 0.8));
        k.x += k.dir * k.v * dt;
        if (k.dir > 0 && k.x > 34) k.x = -34; if (k.dir < 0 && k.x < -34) k.x = 34;
      }
      if (!busy && !leaving) { spotT += dt; if (spotT > 8) { spotT = 0; saveSpot(); } }
      // camera
      const g = goalCam();
      if (gaze.t >= 0) { gaze.t += dt; const T = 4.8, tt = gaze.t, raw = tt < 1.7 ? tt / 1.7 : tt < 3.2 ? 1 : Math.max(0, 1 - (tt - 3.2) / 1.6), e = raw * raw * (3 - 2 * raw); g.z -= e * 8; if (tt >= T) gaze.t = -1; }
      if (push) { v.cam.x += (push.x - v.cam.x) * Math.min(1, dt * 2.5); v.cam.z += (push.z - v.cam.z) * Math.min(1, dt * 2.5); }
      else if (intro) { if (intro.k > 0) { intro.k = Math.min(1, intro.k + dt * 0.45); const e = intro.k * intro.k * (3 - 2 * intro.k); v.cam.x = g.x * e; v.cam.z = (GATE_Z - 6) + (g.z - (GATE_Z - 6)) * e; } }
      else { v.cam.x += (g.x - v.cam.x) * Math.min(1, dt * 4); v.cam.z += (g.z - v.cam.z) * Math.min(1, dt * 4); }
      // ---- draw: ground, blocks, the tower and its annexes, lamp pools, then everything standing, sorted by depth ----
      c.fillStyle = "#07081a"; c.fillRect(0, 0, v.W, v.H);
      c.drawImage(G.cv, Math.round((G.X0 - v.cam.x) * PPM + v.W / 2), Math.round((Z0 - v.cam.z) * PPM + v.H / 2));
      drawHome();
      for (const l of lamps) if (v.onScreen(l.x, l.z, 3)) drawLampPool(l);
      drawGuide(time, busy || !!intro);
      for (const th of things) if (liveOf(th)) halo(c, v.sx(th.at.x), v.sy(th.at.z), th.id === "tower" ? "#ffc23d" : "#2fe6ff", th.a * 0.9, time);
      const list = [];
      for (const b of BLOCKS) list.push({ z: b.z1, f: () => drawBlock(b) });
      list.push({ z: GATE_Z, f: () => drawTower(time) }, { z: GATE_Z + 0.05, f: () => drawService(time) }, { z: GATE_Z - 0.3, f: () => drawMaint(time) });
      list.push({ z: midZ + 0.45, f: () => drawSignal(time) }, { z: midZ - 6 + 2.6, f: () => drawMarket(time) });
      for (const l of lamps) if (v.onScreen(l.x, l.z, 4)) list.push({ z: l.z, f: () => drawLamp(l, time) });
      for (const tr of trees) if (v.onScreen(tr.x, tr.z, 4)) list.push({ z: tr.z, f: () => drawTree(tr, time) });
      for (const b of benches) if (v.onScreen(b.x, b.z, 3)) list.push({ z: b.z + 0.8, f: () => drawBench(b) });
      for (const k of parked) if (v.onScreen(k.x, k.z, 4)) list.push({ z: k.z + 1.2, f: () => drawCar(k, time, false) });
      for (const k of cars) if (v.onScreen(k.x, k.z, 4)) list.push({ z: k.z + 0.6, f: () => drawCarSide(k) });
      for (const h of [...walkers, salma, nasser]) if (v.onScreen(h.pos.x, h.pos.z, 2)) list.push({ z: h.pos.z, f: () => h.draw(v, time) });
      list.push({ z: player.pos.z, f: () => player.draw(v, time) });
      list.sort((a, b) => a.z - b.z);
      for (const o of list) o.f();
      // markers over the live spots
      for (const th of things) if (liveOf(th) && (!busy || th.a > 0.5) && (th.id !== "home" || th.a > 0.2)) marker(c, v.sx(th.mark.x), v.sy(th.mark.z, th.mark.y), th.id === "tower" ? "#ffc23d" : th === mk ? "#ff3fb4" : th === svc || th === mt ? "#ffb020" : "#2fe6ff", time + th.mark.z, th.id === "tower");
      // the night: a cool tint, motes drifting in the lamplight
      dark(0.16);
      c.fillStyle = "rgba(255,230,190,.5)";
      for (const m of motes) { m.z += dt * m.s * 0.3; m.x += Math.sin(time + m.z) * dt * 0.1; if (m.z > v.cam.z + 15) m.z -= 30; if (m.z < v.cam.z - 15) m.z += 30; c.fillRect(v.sx(v.cam.x + m.x), v.sy(m.z), 1, 1); }
      void facing; void drawPerson;
    },
    exit() { flash(false); if (!leaving) saveSpot(); game.save.flush(); },
    dispose() {
      game.street?.tower?.close(); game.street = null; game.bus.off("station-closed", onStationClose); game.input.clear();
      game.root.classList.remove("gm-pxw"); view.dispose(); game.canvas.style.visibility = "";
    }
  };
}
