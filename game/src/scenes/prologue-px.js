/* The prologue «الإشارة» in 2D pixel art (2026-10-27 world conversion). The same film as the 3D prologue
 * (scenes/prologue.js): the same shots in the same order and length (prologue-shots.js), the same subtitles and the
 * closing title (story/prologue.js), the same events (the device waking, Yousuf's message, the train, the lights
 * failing, the signal «40», the title), the same letterbox, skip button and way on to the room — painted as pixel
 * scenes with slow pans and parallax instead of Babylon sets. */
import { SHOTS, EVENTS, DURATION, shotStarts } from "./prologue-shots.js";
import { PROLOGUE as P } from "../story/prologue.js";
import { glow, rng, text, skyline, bake, clamp } from "../px/core.js";
import { drawPerson } from "../px/sprites.js";
import { tl, getLang } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";

const ease = (k) => k * k * (3 - 2 * k);

export async function create(game, params = {}) {
  const next = params.next || "room", nextParams = params.nextParams || { arrival: true, fade: 700 };
  let sent = false;
  const goNext = () => { if (sent) return; sent = true; const go = () => (game.scenes.busy ? setTimeout(go, 60) : game.scenes.go(next, nextParams)); go(); };
  const hero = game.save.data?.char || "hoodie", mom = hero === "casual-f" ? "suit-f" : "casual-f";

  const canvas = document.createElement("canvas"); canvas.className = "gm-canvas gm-px"; canvas.setAttribute("aria-hidden", "true"); game.surface.appendChild(canvas);
  const c = canvas.getContext("2d", { alpha: false });
  let W = 320, H = 180, S = 2;
  const resize = () => { const r = game.surface.getBoundingClientRect(); S = clamp(Math.floor(Math.min(r.width / 300, r.height / 170)), 2, 8); W = Math.ceil(r.width / S); H = Math.ceil(r.height / S); canvas.width = W; canvas.height = H; canvas.style.width = W * S + "px"; canvas.style.height = H * S + "px"; c.imageSmoothingEnabled = false; cache.clear(); };
  const cache = new Map(), baked = (k, w, h, f) => { if (!cache.has(k)) cache.set(k, bake(w, h, f)); return cache.get(k); };
  addEventListener("resize", resize); resize();
  game.canvas.style.visibility = "hidden";

  // ---- the places ----
  function mountains(R, base, amp, col, step, off) {
    c.fillStyle = col; c.beginPath(); c.moveTo(-2, H);
    for (let x = -2 - (off % step); x <= W + step; x += step) c.lineTo(x, base - (Math.sin((x + off) * 0.021) * 0.5 + Math.sin((x + off) * 0.053 + 1) * 0.3 + 0.6) * amp);
    c.lineTo(W + 2, H); c.fill(); void R;
  }
  function village(p, zoom) {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#1a1c4a"); g.addColorStop(0.45, "#c8607a"); g.addColorStop(0.75, "#ffb27a"); g.addColorStop(1, "#ffd9a0");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    glow(c, W * 0.72, H * 0.52, H * 0.3, "rgba(255,220,150,.9)", 0.8); c.fillStyle = "#fff0c8"; c.beginPath(); c.arc(W * 0.72, H * 0.55, H * 0.05, 0, Math.PI * 2); c.fill();
    const o = p * 120 + zoom * 60;
    mountains(null, H * 0.62, H * 0.28, "#5a3a5a", 3, o * 0.2);
    mountains(null, H * 0.72, H * 0.24, "#3a2a40", 3, o * 0.45 + 300);
    // the terraces and the stone houses of the village (Asir style: stacked stone, white bands)
    const R = rng(12), by = H * 0.8 + zoom * H * 0.1;
    c.fillStyle = "#2a3a24"; c.fillRect(0, by - 6, W, H);
    for (let i = 0; i < 5; i++) { c.fillStyle = i % 2 ? "#3a4a2a" : "#33421f"; c.fillRect(0, by + i * 6, W, 3); }
    const k = 1 + zoom * 1.6;
    for (let i = 0; i < 9; i++) {
      const hx = ((i * 47 + 20 - o * 0.9) % (W + 80)) - 40, hw = (12 + R() * 10) * k, hh = (16 + R() * 18) * k, hy = by - hh + R() * 6;
      const mine = i === 4;
      c.fillStyle = mine ? "#8a6a4a" : "#6a5040"; c.fillRect(hx, hy, hw, hh);
      for (let yy = hy + 3 * k; yy < hy + hh; yy += 5 * k) { c.fillStyle = "#e8e2d6"; c.fillRect(hx, yy, hw, Math.max(1, k)); }
      c.fillStyle = "#e8e2d6"; for (let tx = hx; tx < hx + hw; tx += 3 * k) c.fillRect(tx, hy - k, Math.max(1, k), Math.max(1, k));
      c.fillStyle = "#1a1210"; c.fillRect(hx + hw / 2 - k, hy + hh - 5 * k, 3 * k, 5 * k);
      if (mine || R() < 0.4) { c.fillStyle = "#ffcf6a"; c.fillRect(hx + 2 * k, hy + 4 * k, 2 * k, 2 * k); glow(c, hx + 3 * k, hy + 5 * k, 6 * k, "rgba(255,200,110,.7)", 0.6); }
    }
    for (let i = 0; i < 18; i++) { const bx = (i * 31 - o * 0.3) % W, bly = H * 0.3 + Math.sin(i + p * 6) * 6; if (i % 6 === 0) { c.fillStyle = "#1a1018"; c.fillRect((bx + W) % W, bly, 2, 1); } }
  }
  function home(p, mode, ev) {
    // the room at first light: plaster wall, a window of dawn, the table with the old device and the key
    c.fillStyle = "#2a2230"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#3a2e3a"; c.fillRect(0, H * 0.68, W, H);
    for (let x = 0; x < W; x += 12) { c.fillStyle = "#33283a"; c.fillRect(x, H * 0.68, 1, H); }
    const wx = W * 0.62 - p * 8, wy = H * 0.14, ww = W * 0.26, wh = H * 0.34;
    const g = c.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, "#c8607a"); g.addColorStop(1, "#ffd9a0"); c.fillStyle = g; c.fillRect(wx, wy, ww, wh);
    c.fillStyle = "#1a1418"; c.fillRect(wx + ww / 2, wy, 2, wh); c.fillRect(wx, wy + wh / 2, ww, 2); c.fillRect(wx - 3, wy - 3, ww + 6, 3); c.fillRect(wx - 3, wy + wh, ww + 6, 4);
    glow(c, wx + ww / 2, wy + wh, H * 0.5, "rgba(255,190,140,.35)", 0.7);
    // dust in the light
    for (let i = 0; i < 24; i++) { const R = rng(i + 3); const dx = wx - 20 + R() * (ww + 30), dy = (R() * H * 0.7 + p * 30 * (0.5 + R())) % (H * 0.7); c.fillStyle = "rgba(255,230,190,.6)"; c.fillRect(dx, dy + 10, 1, 1); }
    // the table
    const z = mode === "screen" ? 2.6 + p * 0.6 : mode === "key" ? 2.2 + p * 0.5 : 1 + p * (mode === "push" ? 0.5 : 0.2);
    const cx = W * 0.42, ty = H * 0.62;
    const s = (v) => v * z;
    c.fillStyle = "#4a3222"; c.fillRect(cx - s(40), ty, s(80), s(5)); c.fillStyle = "#2a1c12"; c.fillRect(cx - s(36), ty + s(5), s(3), H); c.fillRect(cx + s(33), ty + s(5), s(3), H);
    // the device: an old terminal with a little screen
    const dx = cx - s(14), dy = ty - s(16);
    c.fillStyle = "#3a3a44"; c.fillRect(dx, dy, s(26), s(16)); c.fillStyle = "#22222a"; c.fillRect(dx + s(2), dy + s(2), s(16), s(10));
    const on = ev.has("device-on"), msg = ev.has("message") && !ev.has("message-end");
    if (on) {
      c.fillStyle = msg ? "#0a2a30" : "#0a1a20"; c.fillRect(dx + s(2), dy + s(2), s(16), s(10));
      const tt = performance.now() / 1000;
      c.fillStyle = "#2fe6ff"; for (let i = 0; i < 14; i++) { const h = msg ? 1 + Math.abs(Math.sin(tt * 9 + i * 0.8)) * s(3.5) : 1; c.fillRect(dx + s(3) + i * s(1), dy + s(7) - h / 2, Math.max(1, s(0.6)), h); }
      if (!msg && Math.floor(tt * 2) % 2) text(c, "40", dx + s(7), dy + s(4), "#2fe6ff", Math.max(1, Math.round(z / 2)));
      glow(c, dx + s(10), dy + s(7), s(30), "rgba(47,230,255,.6)", 0.6);
    }
    c.fillStyle = "#ffc23d"; c.fillRect(dx + s(20), dy + s(5), s(3), s(2)); // a dial
    // the brass key beside it
    const kx = cx + s(18), ky = ty - s(2);
    c.fillStyle = "#c8962c"; c.beginPath(); c.arc(kx, ky, s(2), 0, Math.PI * 2); c.fill(); c.fillRect(kx + s(1.5), ky - s(0.6), s(8), s(1.2)); c.fillRect(kx + s(7), ky, s(1), s(2)); c.fillRect(kx + s(9), ky, s(1), s(1.6));
    if (mode !== "screen" && mode !== "key") {
      drawPerson(c, hero, Math.round(cx - s(52)), Math.round(H * 0.92), 3, 0);
    }
  }
  function mother(p) {
    c.fillStyle = "#1a1418"; c.fillRect(0, 0, W, H);
    const dx = W * 0.62, dw = W * 0.22, dy = H * 0.12;
    c.fillStyle = "#ffd9a0"; c.fillRect(dx, dy, dw, H * 0.8); glow(c, dx + dw / 2, H * 0.6, H * 0.6, "rgba(255,200,140,.5)", 0.8);
    c.fillStyle = "#2a2230"; c.fillRect(0, H * 0.92, W, H);
    c.save(); c.translate(dx + dw / 2, H * 0.92); c.scale(3, 3); drawPerson(c, mom, 0, 0, 0, 0); c.restore();
    c.save(); c.translate(W * 0.2 - p * 6, H * 0.98); c.scale(3.4, 3.4); drawPerson(c, hero, 0, 0, 1, 0); c.restore();
  }
  function keyShot(p) {
    c.fillStyle = "#1a1418"; c.fillRect(0, 0, W, H); glow(c, W / 2, H / 2, H * 0.6, "rgba(255,200,120,.4)", 0.8);
    const k = Math.max(2, Math.round(Math.min(W, H) / 60)) * (1 + p * 0.25), cx = W / 2 - 14 * k, cy = H / 2;
    c.fillStyle = "#e8b48c"; c.fillRect(cx - 6 * k, cy + 2 * k, 40 * k, 10 * k); // the hand under it
    c.fillStyle = "#8a5a14"; c.beginPath(); c.arc(cx, cy, 6 * k, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#c8962c"; c.beginPath(); c.arc(cx, cy, 5 * k, 0, Math.PI * 2); c.fill(); c.fillStyle = "#1a1418"; c.beginPath(); c.arc(cx, cy, 2 * k, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#c8962c"; c.fillRect(cx + 5 * k, cy - 1.5 * k, 22 * k, 3 * k); c.fillRect(cx + 20 * k, cy + 1.5 * k, 2 * k, 4 * k); c.fillRect(cx + 24 * k, cy + 1.5 * k, 2 * k, 3 * k);
    c.fillStyle = "#ffe39a"; c.fillRect(cx + 5 * k, cy - 1.5 * k, 22 * k, Math.max(1, k / 2));
    text(c, "40", cx + 9 * k, cy - 1 * k, "#5a3008", Math.max(1, Math.round(k / 2)));
    glow(c, cx + 12 * k, cy, 20 * k, "rgba(255,226,140,.5)", 0.4 + Math.sin(performance.now() / 300) * 0.1);
  }
  function train(p) {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#05071a"); g.addColorStop(1, "#1a1240"); c.fillStyle = g; c.fillRect(0, 0, W, H);
    const R = rng(5); for (let i = 0; i < 80; i++) { c.fillStyle = "#6a74b0"; c.fillRect(R() * W, R() * H * 0.6, 1, 1); }
    const o = p * 900;
    mountains(null, H * 0.7, H * 0.2, "#100c24", 3, o * 0.15);
    mountains(null, H * 0.78, H * 0.12, "#0a0818", 3, o * 0.4 + 200);
    // the elevated track and its pylons
    const ty = H * 0.7; c.fillStyle = "#2a2c44"; c.fillRect(0, ty, W, 4); c.fillStyle = "#2fe6ff"; c.fillRect(0, ty + 4, W, 1);
    for (let x = -(o % 60); x < W; x += 60) { c.fillStyle = "#1a1c30"; c.fillRect(x, ty + 5, 4, H); }
    // the maglev: a long white body with a cyan stripe, lit windows, a glowing nose
    const tx = W * 0.15 + Math.sin(p * 3) * 4, tl0 = W * 0.9, tyy = ty - 16;
    c.fillStyle = "#d8e0ee"; c.fillRect(tx - tl0, tyy, tl0, 14); c.beginPath(); c.moveTo(tx, tyy); c.lineTo(tx + 26, tyy + 10); c.lineTo(tx + 26, tyy + 14); c.lineTo(tx, tyy + 14); c.fill();
    c.fillStyle = "#2fe6ff"; c.fillRect(tx - tl0, tyy + 9, tl0 + 20, 2);
    for (let x = tx - tl0 + 4; x < tx - 4; x += 8) { c.fillStyle = "#ffe8a0"; c.fillRect(x, tyy + 3, 5, 4); }
    glow(c, tx + 26, tyy + 11, 30, "rgba(200,240,255,.8)", 0.8); glow(c, tx - tl0 / 2, ty + 2, tl0 / 2, "rgba(47,230,255,.25)", 0.6);
    for (let i = 0; i < 12; i++) { const sx = (W - ((o * 2 + i * 53) % (W + 40))), sy = tyy - 6 + (i % 5) * 6; c.fillStyle = "rgba(160,220,255,.4)"; c.fillRect(sx, sy, 14, 1); }
  }
  function city(p) {
    const k = Math.max(1, Math.round(H / 110));
    const key = "city" + W + "x" + H + ":" + Math.floor(performance.now() / 250);
    const img = baked(key, W, Math.round(H * 1.5), (cc) => skyline(cc, 0, 0, W, Math.round(H * 1.5), performance.now() / 1000, k));
    if (cache.size > 6) { for (const kk of cache.keys()) if (kk.startsWith("city") && kk !== key) cache.delete(kk); }
    const y = -Math.round(ease(p) * H * 0.42);
    c.drawImage(img, 0, y);
  }
  function cabin(p, ev) {
    const failed = ev.has("lights-fail"), sig = ev.has("signal");
    c.fillStyle = failed ? "#05050c" : "#1c1e2e"; c.fillRect(0, 0, W, H);
    // the aisle in one-point perspective toward the display at the end of the car
    const vx = W / 2, vy = H * 0.42, z = 1 + ease(p) * 0.8;
    const lit = failed ? 0.15 : 1;
    c.globalAlpha = lit;
    c.fillStyle = "#2a2c44"; c.beginPath(); c.moveTo(0, H); c.lineTo(vx - 18 * z, vy + 22 * z); c.lineTo(vx + 18 * z, vy + 22 * z); c.lineTo(W, H); c.fill();
    c.fillStyle = "#3a3d58"; c.beginPath(); c.moveTo(0, 0); c.lineTo(vx - 18 * z, vy - 18 * z); c.lineTo(vx + 18 * z, vy - 18 * z); c.lineTo(W, 0); c.fill();
    for (let i = 0; i < 6; i++) {
      const f = (i + (p * 2) % 1) / 6, sx = W * 0.5 * (1 - f) + 6, sh = 30 * (1 - f) + 6, sy = vy + 22 * z + (H - vy - 22 * z) * (1 - f) - sh;
      c.fillStyle = "#5a2a6a"; c.fillRect(vx - sx - 8 * (1 - f), sy, 10 * (1 - f) + 3, sh); c.fillRect(vx + sx - 2, sy, 10 * (1 - f) + 3, sh);
      c.fillStyle = "#ffe8a0"; c.fillRect(vx - 40 * (1 - f) - 4, vy - 18 * z - 8 * (1 - f), 80 * (1 - f) + 8, 1);
    }
    c.globalAlpha = 1;
    // the display: the city's ads, then (when the lights fail) the signal «40»
    const dw = 36 * z, dh = 20 * z, dx = vx - dw / 2, dy = vy - dh / 2;
    c.fillStyle = "#0b0a14"; c.fillRect(dx - 2, dy - 2, dw + 4, dh + 4);
    if (!sig) { c.fillStyle = failed ? "#0a0a10" : "#2a1050"; c.fillRect(dx, dy, dw, dh); if (!failed) { text(c, "MJT", dx + dw / 2 - 5, dy + dh / 2 - 2, "#ffc23d"); glow(c, vx, vy, dw, "rgba(138,92,255,.6)", 0.5); } }
    else {
      const tt = performance.now() / 1000, gl = Math.sin(tt * 30) > 0.6;
      c.fillStyle = "#04121f"; c.fillRect(dx, dy, dw, dh);
      for (let yy = dy; yy < dy + dh; yy += 2) { c.fillStyle = "rgba(47,230,255,.08)"; c.fillRect(dx, yy, dw, 1); }
      const kk = Math.max(1, Math.round(z * 2)); text(c, "40", vx - textWidth(kk) / 2 + (gl ? 2 : 0), vy - 2.5 * kk, gl ? "#ff3fb4" : "#2fe6ff", kk);
      glow(c, vx, vy, dw * 1.3, "rgba(47,230,255,.8)", 0.8 + Math.sin(tt * 9) * 0.2);
    }
    if (failed && !sig) for (let i = 0; i < 3; i++) { c.fillStyle = "rgba(255,64,96,.5)"; c.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
  }
  const textWidth = (k) => 7 * k;

  // ---- the interface (the same as the 3D prologue: letterbox, subtitles, the title, dips, skip) ----
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
    let a = Math.max(0, 1 - tt / 1.8);
    for (const ct of cutTimes) { if (tt > ct - 0.3 && tt <= ct) a = Math.max(a, (tt - (ct - 0.3)) / 0.3); else if (tt > ct && tt < ct + 0.45) a = Math.max(a, 1 - (tt - ct) / 0.45); }
    if (tt > DURATION - 0.9) a = Math.max(a, (tt - (DURATION - 0.9)) / 0.9);
    return Math.min(1, a);
  };
  let st = 0, done = false, running = false, subNow = null;
  const fired = new Set();
  const finish = () => { if (done) return; done = true; L.classList.add("out"); game.audio.sfx("whoosh", { down: true }); goNext(); };
  const skip = () => { if (!done) finish(); };
  $("#gm-cine-skip").addEventListener("click", skip);
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); skip(); } }; addEventListener("keydown", onKey, true);
  const fire = (ev) => {
    if (ev === "device-on") game.audio.sfx("scan"); else if (ev === "message") game.audio.sfx("ping"); else if (ev === "train") game.audio.sfx("whoosh");
    else if (ev === "lights-fail") game.audio.sfx("locked"); else if (ev === "signal") game.audio.sfx("scan");
    else if (ev === "title") { titleEl.hidden = false; requestAnimationFrame(() => titleEl.classList.add("on")); game.audio.sfx("reveal"); }
  };
  const step = (dt) => {
    if (done || !running) return;
    st += dt; if (st >= DURATION) { st = DURATION; finish(); }
    for (const e of EVENTS) if (!fired.has(e.ev) && st >= e.at) { fired.add(e.ev); fire(e.ev); }
    const sub = P.subtitles.find((x) => st >= x.at && st < x.at + x.dur) || null;
    if (sub !== subNow) {
      subNow = sub;
      if (!sub) subEl.classList.remove("on");
      else {
        const ar = lang === "ar", who = sub.who ? (ar ? sub.who.ar : sub.who.en) : "";
        subEl.dir = ar ? "rtl" : "ltr"; subEl.lang = ar ? "ar" : "en";
        subEl.querySelector(".who").textContent = who; subEl.querySelector(".who").hidden = !who; subEl.querySelector(".line").textContent = ar ? sub.text.ar : sub.text.en;
        subEl.hidden = false; subEl.classList.remove("on"); void subEl.offsetWidth; subEl.classList.add("on");
      }
    }
  };
  const draw = () => {
    let i = 0; while (i < SHOTS.length - 1 && st >= starts[i + 1]) i++;
    const s = SHOTS[i], p = clamp((st - starts[i]) / s.dur, 0, 1), e = ease(p);
    if (i === 0) village(e, 0); else if (i === 1) village(1, e);
    else if (i === 2) home(e, "push", fired); else if (i === 3) home(e, "shoulder", fired); else if (i === 4) home(e, "screen", fired);
    else if (i === 5) mother(e); else if (i === 6) keyShot(e);
    else if (i === 7) train(p); else if (i === 8) city(e); else cabin(i === 9 ? e : 1, fired);
    dipEl.style.setProperty("--a", dipAt(st).toFixed(3));
  };
  game.prologue = { skip, forward: (sec) => { let r = sec; while (r > 0 && !done) { const d = Math.min(0.25, r); step(d); r -= d; } }, shareContext: true, engine: "pixel", get time() { return st; } };
  return {
    scene: null, camera: null, engine: "pixel",
    enter() { game.audio.music(null); game.audio.ambient("room"); resize(); running = true; },
    update(dt) { step(dt); draw(); },
    exit() { },
    dispose() {
      game.prologue = null; removeEventListener("resize", resize); removeEventListener("keydown", onKey, true);
      canvas.remove(); game.canvas.style.visibility = ""; game.input.setEnabled(true);
    }
  };
}
