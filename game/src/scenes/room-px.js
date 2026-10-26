/* Chapter 0 — the player's apartment, in 2D pixel art (top-down 3/4 view, 2026-10-27 world conversion).
 * Same room, same story and the same rules as the 3D room (scenes/room.js, still there as the 3D option in Settings):
 * the same coordinates (x −4…4, z −3…3), the same six things to use, the same save flags (intro.done, room.*), the
 * same server missions (c0.explore, c0.mining, c0.leave), the same HUD, dialogue, MJT OS on the computer and the
 * door to the street, and the same game.room test hooks. Only the drawing and the camera are new. */
import { makeView, PPM, rect, glow, marker, halo, skyline, bake, rng, clamp, text } from "../px/core.js";
import { PxHero } from "../px/hero.js";
import { PALETTE, ASSET, charById } from "../config.js";
import { t, tl, fill } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";
import { openPause } from "../ui/menus.js";
import { CHAPTER0 as C } from "../story/chapter0.js";
import { openOS } from "../os/desktop.js";
import "../os/apps.js";

const W = 4, D = 3, H = 3;
const WIN = { x0: -1.7, x1: 1.7, y0: 0.75, y1: 2.65 };
const DOOR = { z0: 1.0, z1: 2.1 };
const STILL = { x: 0, y: 0, run: false };
const hex = (n) => "#" + n.toString(16).padStart(6, "0");

/** the oak floor, baked once: planks of varied tone, seams, a few knots */
function floorTex() {
  const w = W * 2 * PPM, h = D * 2 * PPM, R = rng(17);
  return bake(w, h, (c) => {
    for (let y = 0; y < h; y += 4) {
      let x = -Math.floor(R() * 20);
      while (x < w) {
        const len = 18 + Math.floor(R() * 22), tone = ["#5a3a26", "#62402a", "#563623", "#6a4630", "#4e3220"][Math.floor(R() * 5)];
        c.fillStyle = tone; c.fillRect(x, y, len, 4);
        c.fillStyle = "rgba(255,220,180,.06)"; c.fillRect(x, y, len, 1);
        c.fillStyle = "#2a1a10"; c.fillRect(x + len - 1, y, 1, 4);
        if (R() < 0.15) { c.fillStyle = "#3e2616"; c.fillRect(x + 4 + Math.floor(R() * (len - 8)), y + 1, 2, 2); }
        x += len;
      }
      c.fillStyle = "#24160c"; c.fillRect(0, y + 3, w, 1);
    }
  });
}

export async function create(game, params = {}) {
  const save = game.save.data || {}, name = save.name || "…";
  const view = makeView(game, (cw, ch) => (cw / ch < 0.8 ? [8.9, 9] : [11.5, 9.5]));
  game.root.classList.add("gm-pxw");
  const FLOOR = floorTex();
  let doorK = 0, doorGoal = 0, led = hex(PALETTE.red), pad = hex(PALETTE.red);
  if (game.save.flag("room.done")) { led = hex(PALETTE.gold); pad = "#3dffb0"; }

  // ---------- mining (the c0.mining mission is the server's: it checks its own record) ----------
  let mining = null;
  const minedOnce = (m) => { if (m && (m.session || Number(m.totals?.sessions) > 0)) game.missions?.complete("c0.mining"); };
  game.host.api("GET", "/api/mjt/mining").then((m) => { mining = m; minedOnce(m); }).catch(() => { mining = null; });

  // ---------- furniture (metres) and what you can't walk through ----------
  const colliders = [
    { min: { x: 3.0, z: -2.45 }, max: { x: 4, z: -0.7 } },      // desk
    { min: { x: -4, z: -3 }, max: { x: -2.3, z: -0.9 } },        // bed
    { min: { x: 2.9, z: 2.2 }, max: { x: 4, z: 3 } },            // boxes
    { min: { x: -3.9, z: 2.25 }, max: { x: -3.2, z: 2.95 } },    // plant
    { min: { x: -2.25, z: -3 }, max: { x: -1.85, z: -2.55 } },   // lamp
    { min: { x: 2.1, z: -3 }, max: { x: 2.95, z: -2.7 } }        // shelf
  ];
  const world = { colliders, bounds: { minX: -W + 0.05, maxX: W - 0.05, minZ: -D + 0.05, maxZ: D - 0.1 } };

  // ---------- interactables (the same spots as the 3D room) ----------
  const done = (k) => !!game.save.flag("room." + k);
  const things = [
    { id: "window", at: { x: 0, z: -2.25 }, mark: { x: 0, z: -3, y: 2.95 }, face: { x: 0, z: -3 } },
    { id: "computer", at: { x: 2.55, z: -0.95 }, mark: { x: 3.5, z: -1.55, y: 1.75 }, face: { x: 3.6, z: -1.55 } },
    { id: "door", at: { x: 3.3, z: 1.55 }, mark: { x: 3.95, z: 1.55, y: 2.6 }, face: { x: 4, z: 1.55 } },
    { id: "boxes", at: { x: 2.55, z: 1.9 }, mark: { x: 3.4, z: 2.6, y: 1.5 }, face: { x: 3.1, z: 2.6 } },
    { id: "bed", at: { x: -1.75, z: -1.6 }, mark: { x: -3.1, z: -1.9, y: 1.0 }, face: { x: -3, z: -1.9 } },
    { id: "panel", at: { x: -2.9, z: -0.05 }, mark: { x: -3.85, z: -0.05, y: 2.6 }, face: { x: -4, z: -0.05 } }
  ];
  for (const th of things) { th.goal = C.goals.includes(th.id); th.a = 0; }

  // ---------- the player ----------
  const player = new PxHero(save.char || "hoodie", game.audio);
  const fromDoor = params.from === "door";
  const pos = fromDoor ? { x: W - 0.7, z: (DOOR.z0 + DOOR.z1) / 2, r: -Math.PI / 2 } : save.pos && !params.arrival && (save.scene || "room") === "room" ? save.pos : { x: -0.4, z: 0.9, r: Math.PI };
  if (fromDoor) { doorK = 1; setTimeout(() => { doorGoal = 0; game.audio.sfx("open"); }, 900); }
  player.pos.set(clamp(Number(pos.x) || 0, -W + 0.4, W - 0.4), 0, clamp(Number(pos.z) || 0, -D + 0.4, D - 0.4)); player.heading = pos.r ?? Math.PI;

  // ---------- HUD (the same as the 3D room) ----------
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

  // ---------- interaction (the same flow as the 3D room) ----------
  let near = null, busy = false, helpGone = false, look = 0, lookGoal = 0;
  const label = (th) => C.things[th.id];
  const showAct = (th) => { const a = $("#gm-act"); if (!th) { a.hidden = true; return; } $("#gm-act-k").textContent = tl(label(th).label); $("#gm-act-v").textContent = tl(label(th).verb); a.hidden = false; a.dataset.goal = th.goal ? "1" : ""; };
  const lines = (arr) => arr.map((l) => fill(tl(l), { name }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function use(th) {
    if (busy) return; busy = true; showAct(null); player.walkTo(null); player.face(th.face.x, th.face.z);
    try {
      if (th.id === "window") {
        lookGoal = 1; game.audio.sfx("whoosh"); await wait(700);
        await game.ui.dialog(lines(C.things.window.lines), tl(C.narrator)); lookGoal = 0;
      } else if (th.id === "computer") {
        await player.gesture("Interact");
        if (!done("computer")) await game.ui.dialog(lines(C.things.computer.first), tl(C.narrator));
        mark("computer"); busy = false; computer(); return;
      } else if (th.id === "door") {
        if (done("done")) { await openDoor(); return; }
        game.audio.sfx("locked"); pad = "#ff4060"; await player.gesture("Interact");
        await game.ui.dialog(lines(C.things.door.lines), tl(C.narrator)); pad = hex(PALETTE.red);
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
    game.missions?.complete("c0.explore"); // the server decides and grants the XP
    card(tl(C.title) + " · " + tl(C.name), t("اكتمل", "Complete"));
    await player.gesture("Cheer"); await game.ui.dialog(lines(C.done), tl(C.narrator));
    led = hex(PALETTE.gold); pad = "#3dffb0"; busy = false;
  }
  async function openDoor() {
    showAct(null); pad = "#3dffb0"; led = hex(PALETTE.gold);
    game.scenes.reg.street?.().catch(() => { });
    game.audio.sfx("open"); await player.gesture("Interact");
    card(tl(C.things.door.label), tl(C.things.door.open));
    doorGoal = 1; await wait(1100);
    player.walkTo({ x: W - 0.25, z: (DOOR.z0 + DOOR.z1) / 2 }); await wait(900);
    game.audio.sfx("whoosh"); game.root.classList.add("gm-flash-on"); await wait(380);
    game.save.set({ pos: { x: +(W - 0.7).toFixed(2), z: 1.55, r: -1.57 }, scene: "room", flags: { "room.out": true } }); lastSaved = "";
    game.missions?.complete("c0.leave");
    await game.scenes.go("street", { fade: 250, fadeIn: 700 });
  }
  function card(k, v) { const c = $("#gm-card"); c.querySelector("small").textContent = k; c.querySelector("b").textContent = v; c.hidden = false; c.classList.remove("on"); void c.offsetWidth; c.classList.add("on"); setTimeout(() => { c.hidden = true; }, 3600); }
  // the computer: MJT OS fills the screen (the pixel world has no monitor-in-perspective view); the loop rests meanwhile
  function computer() {
    busy = true; showAct(null);
    const os = openOS(game, {
      user: name,
      onOutside: () => { },
      onClose: () => { game.loop.pause(false); busy = false; refreshBal(); game.host.api("GET", "/api/mjt/mining").then((x) => { mining = x; minedOnce(x); }).catch(() => { }); }
    });
    const wrap = os.panel.parentElement; wrap.classList.add("os-full", "os-px");
    os.panel.classList.add("os-fade"); requestAnimationFrame(() => requestAnimationFrame(() => os.panel.classList.remove("os-fade")));
    game.audio.sfx("whoosh"); setTimeout(() => game.loop.pause(true), 120);
  }
  $("#gm-act").addEventListener("click", () => { if (near) use(near); });
  game.input.on("action", () => { if (game.scenes.name === "room" && near && !busy && !game.ui.modalOpen) use(near); });
  let pending = null;
  const hitThing = (p) => things.find((th) => Math.hypot(p.x - th.mark.x, p.z - (th.mark.z - th.mark.y)) < 0.8 || Math.hypot(p.x - th.at.x, p.z - th.at.z) < 0.5);
  game.input.on("tap", (n) => {
    if (busy || game.ui.modalOpen || game.scenes.name !== "room") return;
    const p = view.toWorld(n.x, n.y), th = hitThing(p);
    if (th) { pending = th; player.walkTo(th.at); }
    else { pending = null; player.walkTo({ x: clamp(p.x, -W + 0.4, W - 0.4), z: clamp(p.z, -D + 0.4, D - 0.4) }); }
    hideHelp();
  });
  player.onArrive = () => { if (pending) { const th = pending; pending = null; use(th); } };
  const hideHelp = () => { if (helpGone) return; helpGone = true; $("#gm-help").classList.add("gone"); };

  // ---------- drawing ----------
  let winCache = null, winT = -1, lookCache = null, lookT = -1;
  const winW = Math.round((WIN.x1 - WIN.x0) * PPM), winH = Math.round((WIN.y1 - WIN.y0) * PPM);
  function drawRoom(time) {
    const c = view.ctx, v = view;
    // the night outside the cut-away: deep blue with a faint grid
    c.fillStyle = "#07081a"; c.fillRect(0, 0, v.W, v.H);
    c.fillStyle = "#0d1030"; for (let y = (v.sy(0) % 16 + 16) % 16; y < v.H; y += 16) c.fillRect(0, y, v.W, 1);
    // the diorama slab under the room, gold edged
    rect(v, "#15121f", -W - 0.35, -D - 0.2, W * 2 + 0.7, D * 2 + 0.75); rect(v, "#ffc23d", -W - 0.35, D + 0.5, W * 2 + 0.7, 0.06);
    // floor + rug
    c.drawImage(FLOOR, v.sx(-W), v.sy(-D));
    rect(v, "#2a1f4a", -1.6, -0.6, 3.2, 2.2); rect(v, "#3b2c66", -1.45, -0.45, 2.9, 1.9); rect(v, "#ffc23d", -1.45, -0.45, 2.9, 0.06); rect(v, "#ffc23d", -1.45, 1.39, 2.9, 0.06);
    for (let i = 0; i < 6; i++) rect(v, "#5a46a0", -1.2 + i * 0.48, 0.35, 0.25, 0.25);
    // the back wall's face (3 m tall) with the window, wainscot, an LED cove and art
    const top = v.sy(-D, H), base = v.sy(-D), x0 = v.sx(-W - 0.16), x1 = v.sx(W + 0.16);
    c.fillStyle = "#3a3458"; c.fillRect(x0, top, x1 - x0, base - top);
    c.fillStyle = "#2c2746"; c.fillRect(x0, v.sy(-D, 0.8), x1 - x0, base - v.sy(-D, 0.8));
    c.fillStyle = "#4a4370"; c.fillRect(x0, v.sy(-D, 0.8), x1 - x0, 1);
    c.fillStyle = "#1b1830"; c.fillRect(x0, top - 3, x1 - x0, 3);
    c.fillStyle = "#2fe6ff"; c.fillRect(x0 + 2, top + 1, x1 - x0 - 4, 1); glow(c, (x0 + x1) / 2, top + 2, 30, "rgba(47,230,255,.25)", 0.6);
    // the window: the city painted in, refreshed a few times a second
    if (!winCache || time - winT > 0.25) { winT = time; winCache = bake(winW, winH, (wc) => skyline(wc, 0, 0, winW, winH, time, 1)); }
    const wx = v.sx(WIN.x0), wy = v.sy(-D, WIN.y1);
    c.fillStyle = "#0b0a14"; c.fillRect(wx - 2, wy - 2, winW + 4, winH + 4); c.drawImage(winCache, wx, wy);
    c.fillStyle = "rgba(160,200,255,.12)"; c.fillRect(wx + 3, wy, 2, winH); c.fillRect(wx + 7, wy, 1, winH);
    c.fillStyle = "#4b4470"; c.fillRect(wx + (winW >> 1), wy, 1, winH); c.fillRect(wx - 3, wy + winH + 1, winW + 6, 2);
    glow(c, wx + winW / 2, base + 6, 34, "rgba(120,140,255,.22)", 0.8);
    // a framed print left of the window, the shelf right of it
    c.fillStyle = "#0b0a14"; c.fillRect(v.sx(-3.4), v.sy(-D, 2.4), 22, 14); c.fillStyle = "#ff3fb4"; c.fillRect(v.sx(-3.4) + 2, v.sy(-D, 2.4) + 2, 18, 10); c.fillStyle = "#ffc23d"; c.fillRect(v.sx(-3.4) + 6, v.sy(-D, 2.4) + 5, 10, 5);
    // the side walls and the low front edge (cut away so the room reads like a model)
    c.fillStyle = "#1b1830"; c.fillRect(v.sx(-W - 0.16), top, v.sx(-W) - v.sx(-W - 0.16), v.sy(D) - top);
    c.fillStyle = "#4a4370"; c.fillRect(v.sx(-W) - 1, top, 1, v.sy(D) - top);
    const rx = v.sx(W), rw = v.sx(W + 0.16) - rx;
    c.fillStyle = "#1b1830"; c.fillRect(rx, top, rw, v.sy(DOOR.z0) - top); c.fillRect(rx, v.sy(DOOR.z1), rw, v.sy(D) - v.sy(DOOR.z1));
    c.fillStyle = "#4a4370"; c.fillRect(rx, top, 1, v.sy(DOOR.z0) - top); c.fillRect(rx, v.sy(DOOR.z1), 1, v.sy(D) - v.sy(DOOR.z1));
    // the door: a steel slab sliding along the wall; the hall light spills in as it opens
    const e = doorK * doorK * (3 - 2 * doorK), dz = DOOR.z0 - e * (DOOR.z1 - DOOR.z0);
    if (e > 0.02) { c.fillStyle = "#ffe0a0"; c.fillRect(rx, v.sy(DOOR.z0), rw + 2, v.sy(DOOR.z1) - v.sy(DOOR.z0)); glow(c, rx - 2, v.sy((DOOR.z0 + DOOR.z1) / 2), 26, "rgba(255,210,140,.8)", e); }
    c.fillStyle = "#2a2f4d"; c.fillRect(rx - 1, v.sy(dz), rw + 1, v.sy(DOOR.z1) - v.sy(DOOR.z0)); c.fillStyle = led; c.fillRect(rx - 1, v.sy(dz) + 1, 1, v.sy(DOOR.z1) - v.sy(DOOR.z0) - 2);
    c.fillStyle = pad; c.fillRect(rx - 2, v.sy(DOOR.z0 - 0.25), 2, 3); glow(c, rx - 2, v.sy(DOOR.z0 - 0.25), 6, pad, 0.6);
    // the news board on the left wall
    const pbx = v.sx(-W) , pbz0 = v.sy(-0.9), pbz1 = v.sy(0.8);
    c.fillStyle = "#ff3fb4"; c.fillRect(pbx, pbz0, 3, pbz1 - pbz0); c.fillStyle = "#160a33"; c.fillRect(pbx + 1, pbz0 + 1, 1, pbz1 - pbz0 - 2);
    c.fillStyle = "#2fe6ff"; c.fillRect(pbx + 1, pbz0 + 2 + Math.floor(time * 6) % Math.max(1, pbz1 - pbz0 - 4), 1, 2);
    glow(c, pbx + 4, (pbz0 + pbz1) / 2, 18, "rgba(255,63,180,.45)", 0.5 + Math.sin(time * 2) * 0.15);
    c.fillStyle = "#1b1830"; c.fillRect(v.sx(-W - 0.16), v.sy(D), v.sx(W + 0.16) - v.sx(-W - 0.16), 4); c.fillStyle = "#4a4370"; c.fillRect(v.sx(-W - 0.16), v.sy(D), v.sx(W + 0.16) - v.sx(-W - 0.16), 1);
  }
  // furniture as sprites: a top and a front face, sorted with the characters by their front edge
  const box3 = (col, top, front, x, z, w, d, h) => {
    const c = view.ctx, v = view, X0 = v.sx(x), X1 = v.sx(x + w), Zt = v.sy(z, h), Zb = v.sy(z + d, h), F = v.sy(z + d);
    c.fillStyle = col; c.fillRect(X0, Zt, X1 - X0, Zb - Zt); c.fillStyle = top; c.fillRect(X0, Zt, X1 - X0, 1);
    c.fillStyle = front; c.fillRect(X0, Zb, X1 - X0, F - Zb); c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(X0, F, X1 - X0, 2);
  };
  const props = [
    { z: -0.9, draw: (time) => { // the bed: frame, mattress, pillow, a violet blanket
      box3("#3a2a22", "#5a4232", "#2a1c16", -3.95, -2.95, 1.65, 2.05, 0.45);
      const v = view, c = v.ctx; c.fillStyle = "#e8e4f2"; c.fillRect(v.sx(-3.8), v.sy(-2.85, 0.45), v.sx(-2.45) - v.sx(-3.8), 8);
      c.fillStyle = "#8a5cff"; c.fillRect(v.sx(-3.85), v.sy(-2.2, 0.45), v.sx(-2.4) - v.sx(-3.85), v.sy(-1.0, 0.45) - v.sy(-2.2, 0.45));
      c.fillStyle = "#6a44cc"; for (let i = 0; i < 4; i++) c.fillRect(v.sx(-3.85), v.sy(-2.0 + i * 0.28, 0.45), v.sx(-2.4) - v.sx(-3.85), 1); void time;
    } },
    { z: -2.55, draw: () => { box3("#2a2238", "#3a3050", "#1c1626", -2.25, -3, 0.4, 0.45, 0.5); const v = view; glow(v.ctx, v.sx(-2.05), v.sy(-2.78, 1.5), 20, "rgba(255,190,110,.9)", 0.9); v.ctx.fillStyle = "#ffcf8a"; v.ctx.fillRect(v.sx(-2.15), v.sy(-2.8, 1.6), 4, 3); v.ctx.fillStyle = "#3a3050"; v.ctx.fillRect(v.sx(-2.07), v.sy(-2.8, 1.3), 1, v.sy(-2.8, 0.5) - v.sy(-2.8, 1.3)); } },
    { z: -2.7, draw: () => { box3("#3a2a22", "#5a4232", "#2a1c16", 2.1, -3, 0.85, 0.3, 1.6); const v = view, c = v.ctx; c.fillStyle = "#ffc23d"; c.fillRect(v.sx(2.2), v.sy(-2.75, 1.6) + 3, 3, 4); c.fillStyle = "#2fe6ff"; c.fillRect(v.sx(2.55), v.sy(-2.75, 1.6) + 2, 2, 5); c.fillStyle = "#ff3fb4"; c.fillRect(v.sx(2.75), v.sy(-2.75, 1.6) + 4, 3, 3); } },
    { z: -0.7, draw: (time) => { // the desk with the monitor turned to the chair, its screen alive
      box3("#2a2340", "#4a3f6a", "#1a1528", 3.0, -2.45, 0.95, 1.75, 0.75);
      const v = view, c = v.ctx, mx = v.sx(3.5), my0 = v.sy(-2.15, 1.35), my1 = v.sy(-0.95, 1.35);
      c.fillStyle = "#0b0a14"; c.fillRect(mx - 1, my0, 4, my1 - my0 + 9);
      const lit = done("computer") ? "#2fe6ff" : "#1a6f8a"; c.fillStyle = lit; c.fillRect(mx - 2, my0 + 1, 2, my1 - my0 + 6);
      if (Math.floor(time * 3) % 2) { c.fillStyle = "#ffffff"; c.fillRect(mx - 2, my0 + 3 + (Math.floor(time * 5) % 10), 2, 1); }
      glow(c, mx - 6, (my0 + my1) / 2 + 6, 26, "rgba(47,230,255,.7)", 0.55 + Math.sin(time * 9) * 0.05);
      c.fillStyle = "#ffc23d"; c.fillRect(v.sx(3.15), v.sy(-0.95, 0.75) - 2, 3, 2); // a coin on the desk
    } },
    { z: -1.35, draw: () => { box3("#1c1a2c", "#3a3658", "#141220", 2.72, -1.75, 0.36, 0.4, 0.5); const v = view; v.ctx.fillStyle = "#2a2840"; v.ctx.fillRect(v.sx(3.02), v.sy(-1.75, 1.0), 2, v.sy(-1.35, 1.0) - v.sy(-1.75, 1.0)); } },
    { z: 2.95, draw: () => { box3("#9a7040", "#c49a5a", "#7a5430", 2.95, 2.25, 0.95, 0.7, 0.5); box3("#8a6236", "#b48a4e", "#6a4628", 3.15, 2.35, 0.6, 0.45, 0.95); const v = view, c = v.ctx; c.fillStyle = "#e0c890"; c.fillRect(v.sx(3.4), v.sy(2.35, 0.95), 2, v.sy(2.8, 0.95) - v.sy(2.35, 0.95)); } },
    { z: 2.95, draw: (time) => { box3("#5a3a2a", "#7a5038", "#3a2418", -3.85, 2.3, 0.6, 0.6, 0.4); const v = view, c = v.ctx, cx = v.sx(-3.55), cy = v.sy(2.55, 0.5);
      const sway = Math.round(Math.sin(time * 1.3)); c.fillStyle = "#1f7a5a"; c.fillRect(cx - 6 + sway, cy - 12, 12, 10); c.fillStyle = "#3dffb0"; c.fillRect(cx - 4 + sway, cy - 14, 3, 6); c.fillRect(cx + 1 + sway, cy - 13, 3, 7); c.fillStyle = "#145a40"; c.fillRect(cx - 5, cy - 4, 10, 3); } }
  ];

  // the camera: the whole room in view; it eases toward the window when the player looks out
  const camGoal = () => ({ x: 0, z: -0.6 + (lookGoal ? -1.2 : 0) });
  let intro = (params.arrival || !game.save.flag("intro.done")) ? { k: 0 } : null;
  view.cam.x = 0; view.cam.z = intro ? -3.8 : -0.6;

  let saveT = 0, lastSaved = "";
  const savePos = () => { const p = { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), r: +player.heading.toFixed(2) }; const k = JSON.stringify(p); if (k !== lastSaved) { lastSaved = k; game.save.set({ pos: p, scene: "room" }); } };
  game.room = { use: (id) => { const th = things.find((x) => x.id === id); if (th) return use(th); }, player, door: () => doorK, engine: "pixel" }; // the game's own tests
  const onStationClose = () => { refreshBal(); game.host.api("GET", "/api/mjt/mining").then((m) => { mining = m; minedOnce(m); }).catch(() => { }); };
  game.bus.on("station-closed", onStationClose);
  game.canvas.style.visibility = "hidden";
  void mining;

  return {
    scene: null, camera: null, engine: "pixel",
    async enter() {
      view.resize(); game.audio.music("room"); game.audio.ambient("room");
      if (intro) {
        busy = true; game.input.setEnabled(false);
        card(tl(C.title), tl(C.name));
        setTimeout(async () => {
          intro.k = 0.0001; await wait(2200);
          await player.gesture("Cheer");
          await game.ui.dialog(lines(C.intro), tl(C.narrator));
          game.save.set({ flags: { "intro.done": true } });
          $("#gm-obj").hidden = false; requestAnimationFrame(() => $("#gm-obj").classList.add("on"));
          busy = false; game.input.setEnabled(true); intro = null;
        }, 1200);
      } else { $("#gm-obj").hidden = done("done"); if (!done("done")) $("#gm-obj").classList.add("on"); }
    },
    update(dt, time) {
      const mv = game.input.update();
      if (Math.abs(mv.x) + Math.abs(mv.y) > 0.1) hideHelp();
      player.update(dt, busy ? STILL : mv, 0, world);
      let best = null, bd = 1.25;
      for (const th of things) { const d = Math.hypot(th.at.x - player.pos.x, th.at.z - player.pos.z); if (d < bd) { bd = d; best = th; } }
      for (const th of things) th.a += ((th === best ? 1 : 0) - th.a) * Math.min(1, dt * 8);
      if (best !== near) { near = best; if (!busy) { showAct(near); if (near) game.audio.sfx("hover"); } }
      if (busy && !$("#gm-act").hidden) showAct(null);
      if (doorK !== doorGoal) doorK = doorGoal > doorK ? Math.min(doorGoal, doorK + dt / 1.2) : Math.max(doorGoal, doorK - dt / 1.2);
      // camera
      const g = camGoal();
      if (intro) { if (intro.k > 0) { intro.k = Math.min(1, intro.k + dt * 0.4); const e = intro.k * intro.k * (3 - 2 * intro.k); view.cam.z = -3.8 + (g.z + 3.8) * e; } }
      else { view.cam.x += (g.x - view.cam.x) * Math.min(1, dt * 3); view.cam.z += (g.z - view.cam.z) * Math.min(1, dt * 3); }
      look += (lookGoal - look) * Math.min(1, dt * 3);
      // draw: the room, then furniture + the player by depth, then markers and light, then the window view on top
      drawRoom(time);
      const list = props.slice(); list.push({ z: player.pos.z, draw: (tm) => player.draw(view, tm) }); list.sort((a, b) => a.z - b.z);
      for (const o of list) o.draw(time);
      const c = view.ctx;
      for (const th of things) {
        const col = th.goal && !done(th.id) ? "#ffc23d" : "#2fe6ff";
        halo(c, view.sx(th.at.x), view.sy(th.at.z), col, th.a * 0.9, time);
        if (!busy || th.a > 0.5) marker(c, view.sx(th.mark.x), view.sy(th.mark.z, th.mark.y), col, time + th.mark.x, th.goal && !done(th.id));
      }
      // night tint over everything but the lights
      c.fillStyle = "rgba(12,10,40,.18)"; c.fillRect(0, 0, view.W, view.H);
      if (look > 0.01) {
        if (!lookCache || lookCache.width !== view.W || lookCache.height !== view.H || time - lookT > 0.25) { lookT = time; lookCache = bake(view.W, view.H, (lc) => skyline(lc, 0, 0, view.W, view.H, time, Math.max(1, Math.round(view.H / 90)))); }
        c.globalAlpha = Math.min(1, look * 1.2); c.drawImage(lookCache, 0, 0); c.globalAlpha = 1;
        text(c, "MJT", view.W / 2 - 5, 6, "#ffc23d");
      }
      saveT += dt; if (saveT > 8) { saveT = 0; savePos(); }
    },
    exit() { savePos(); game.save.flush(); },
    dispose() {
      game.room = null; game.bus.off("station-closed", onStationClose); game.input.clear();
      game.root.classList.remove("gm-pxw"); view.dispose(); game.canvas.style.visibility = "";
    }
  };
}
