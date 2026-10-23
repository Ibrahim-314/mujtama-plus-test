/* مجتمع بلس — «المدينة» character renderer "3d" (city/actor-3d.js). The member's own character — one of the five KayKit
 * Adventurers (CC0, weapons removed, 4 animations: Idle, Walking_A, Interact, Cheer; public/city/chars/*.glb ≈ 130 KB gz
 * each) — rendered live with three.js (public/city/three-city.js, ≈ 146 KB gz, loaded only here, only once).
 *
 *   MPCity.chars            the five characters, by gender (ذكر: الفارس، الساحر، المحارب · أنثى: المغامِرة، الرحّالة)
 *   MPCity.charId()         the member's pick (localStorage, synced to the server prefs namespace "city"); default knight
 *   MPCity.setChar(id)      save a pick (the picker in city/profile.js calls it and re-dresses the city)
 *
 * Only ONE character is ever in the city: the member's own (owner rule 2026-10-23). It stands on a small holo base with the
 * member's name above it, turns toward where it walks, crossfades Idle ↔ Walking, and plays Interact at a door.
 * Without WebGL (or if the model fails to load) the city falls back to the "token" renderer. The render loop runs only
 * while the stage is on screen and the tab is visible; reduced motion renders a still idle pose. */
(function CityActor3D() {
  "use strict";
  const { el, esc, reduced } = MPCity.util;

  const CHARS = [
    { id: "knight", g: "m", label: { ar: "الفارس", en: "Knight" } },
    { id: "mage", g: "m", label: { ar: "الساحر", en: "Mage" } },
    { id: "barbarian", g: "m", label: { ar: "المحارب", en: "Barbarian" } },
    { id: "rogue", g: "f", label: { ar: "المغامِرة", en: "Adventurer" } },
    { id: "rogue-hooded", g: "f", label: { ar: "الرحّالة", en: "Wanderer" } }
  ];
  const KEY = "mp.city.char", DEF = "knight";
  const valid = (id) => CHARS.some((c) => c.id === id);
  const charId = () => { try { const v = localStorage.getItem(KEY); return valid(v) ? v : DEF; } catch { return DEF; } };
  const signedIn = () => typeof S !== "undefined" && S.me && !!S.me();
  const call = (m, p, b) => (typeof Remote !== "undefined" && Remote.api ? Remote.api(m, p, b) : Promise.reject(new Error("no api")));

  function setChar(id) {
    if (!valid(id)) return false;
    try { localStorage.setItem(KEY, id); } catch { }
    if (signedIn()) call("PUT", "/api/prefs", { ns: "city", values: { char: id } }).catch(() => { });
    return true;
  }
  // adopt the pick made on another device (once per page load)
  let pulled = null;
  function pull() {
    if (pulled) return pulled;
    if (!signedIn()) return Promise.resolve(charId());
    pulled = call("GET", "/api/prefs?ns=city").then((r) => {
      const v = r && r.prefs && r.prefs.city && r.prefs.city.char;
      if (valid(v) && v !== charId()) { try { localStorage.setItem(KEY, v); } catch { } }
      return charId();
    }, () => charId());
    return pulled;
  }

  const glOK = (() => { try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"))); } catch { return false; } })();
  let threeP = null; const three = () => (threeP = threeP || import("/city/three-city.js"));
  const bufs = {}; const glb = (id) => (bufs[id] = bufs[id] || fetch(`/city/chars/${id}.glb`).then((r) => { if (!r.ok) { delete bufs[id]; throw new Error("char " + r.status); } return r.arrayBuffer(); }));

  MPCity.chars = CHARS; MPCity.charId = charId; MPCity.setChar = setChar; MPCity.pullChar = pull;

  MPCity.actor("3d", (layer, { scene }) => {
    const me = (typeof S !== "undefined" && S.me && S.me()) || null;
    const name = (me && (me.name || me.handle)) || "";
    const a = el("div", "cy-actor cy-3d loading");
    a.innerHTML = `<span class="cy-a-shadow"></span><span class="cy-a-base"><i></i><i></i></span><canvas class="cy-3d-c" aria-hidden="true"></canvas>`
      + (name ? `<span class="cy-3d-tag"><bdi>${esc(name)}</bdi></span>` : "");
    a.style.setProperty("--cy-ah", ((scene.actorH || 0.11) * 100).toFixed(2) + "%");
    layer.append(a);
    const canvas = a.querySelector("canvas");

    let city = null, dead = false, raf = 0, last = 0, onScreen = true, want = { moving: false, angle: Math.PI / 4 };
    let yaw = 0.45, yawTo = 0.45, rm = reduced();
    const st = { renderer: null, scene: null, cam: null, mixer: null, acts: {}, cur: null, model: null, h: 2.4 };

    function fade(to, d) {
      const nx = st.acts[to]; if (!nx || st.cur === nx) return;
      nx.reset().setEffectiveWeight(1).play();
      if (st.cur) st.cur.crossFadeTo(nx, d == null ? 0.22 : d, false);
      st.cur = nx;
    }
    function draw1() { if (st.renderer) st.renderer.render(st.scene, st.cam); }
    function size() {
      if (!st.renderer) return;
      const b = canvas.getBoundingClientRect(); if (!b.width || !b.height) return;
      st.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      st.renderer.setSize(b.width, b.height, false);
      const asp = b.width / b.height, h = st.h * 0.58;
      Object.assign(st.cam, { top: h, bottom: -h, left: -h * asp, right: h * asp }); st.cam.updateProjectionMatrix();
      draw1();
    }
    function tick(t) {
      raf = 0; if (dead) return;
      const dt = Math.min(0.06, (t - (last || t)) / 1000); last = t;
      yaw += Math.atan2(Math.sin(yawTo - yaw), Math.cos(yawTo - yaw)) * Math.min(1, dt * 10);
      if (st.model) st.model.rotation.y = yaw;
      if (st.mixer) st.mixer.update(dt);
      draw1(); loop();
    }
    function loop() { if (!raf && !dead && st.renderer && onScreen && !document.hidden && !rm) raf = requestAnimationFrame(tick); }
    const vis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else { last = 0; loop(); } };
    document.addEventListener("visibilitychange", vis);
    const io = "IntersectionObserver" in window ? new IntersectionObserver((e) => { onScreen = e.some((x) => x.isIntersecting); if (!onScreen) { cancelAnimationFrame(raf); raf = 0; } else { last = 0; loop(); } }) : null;
    if (io) io.observe(a);
    const ro = "ResizeObserver" in window ? new ResizeObserver(size) : null; if (ro) ro.observe(canvas);

    (async () => {
      const id = await pull();
      const [THREE, buf] = await Promise.all([three(), glb(id)]);
      if (dead) return;
      const gl = await new Promise((ok, no) => new THREE.GLTFLoader().parse(buf.slice(0), "/city/chars/", ok, no));
      if (dead) return;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const sc = new THREE.Scene();
      // night city light: lavender sky, warm key from the street lamps, magenta and teal neon rims
      sc.add(new THREE.HemisphereLight(0xd8ccff, 0x2a1d55, 1.5));
      const key = new THREE.DirectionalLight(0xffe9d6, 2.2); key.position.set(4, 6, 6); sc.add(key);
      const r1 = new THREE.DirectionalLight(0xff4fd8, 2.2); r1.position.set(-6, 3, -2); sc.add(r1);
      const r2 = new THREE.DirectionalLight(0x46e3d4, 1.5); r2.position.set(2, 3, -6); sc.add(r2);
      const model = gl.scene; sc.add(model);
      const box = new THREE.Box3().setFromObject(model), h = Math.max(1, box.max.y - box.min.y);
      // the art's isometric camera (≈ 31° down, 45° around), framed on the figure
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
      const cy = box.min.y + h * 0.5; cam.position.set(7, cy + 6.1, 7); cam.lookAt(0, cy, 0);
      const mixer = new THREE.AnimationMixer(model), acts = {};
      for (const clip of gl.animations) acts[clip.name] = mixer.clipAction(clip);
      if (acts.Interact) { acts.Interact.setLoop(THREE.LoopOnce, 1); acts.Interact.clampWhenFinished = true; }
      Object.assign(st, { renderer, scene: sc, cam, mixer, acts, model, h });
      fade(want.moving ? "Walking_A" : "Idle", 0); mixer.update(rm ? 0.6 : 0);
      size(); a.classList.remove("loading"); a.classList.add("ready"); a.dataset.char = id;
      api3d.update(want); loop();
    })().catch((e) => { console.warn("[city] 3d character unavailable, using the emblem", e && e.message); if (!dead && city) city.setActor("token"); });

    const api3d = {
      el: a,
      bind(c) { city = c; },
      update(s) {
        want = s; rm = reduced();
        a.classList.toggle("walk", !!s.moving);
        if (s.moving) { // screen heading → the iso world: right = (1,0,-1), down = (1,0,1)
          const dx = Math.cos(s.angle), dy = Math.sin(s.angle);
          yawTo = Math.atan2(dx + dy, dy - dx);
        }
        if (!st.mixer) return;
        if (st.cur !== st.acts.Interact) fade(s.moving ? "Walking_A" : "Idle");
        if (rm) { if (st.model) st.model.rotation.y = yaw = yawTo; draw1(); } else loop();
      },
      enter() { a.classList.add("enter"); if (st.acts.Interact) fade("Interact", 0.15); },
      exit() { a.classList.remove("enter"); fade(want.moving ? "Walking_A" : "Idle", 0.2); },
      destroy() {
        dead = true; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", vis);
        if (io) io.disconnect(); if (ro) ro.disconnect();
        if (st.renderer) { st.renderer.dispose(); try { st.renderer.forceContextLoss(); } catch { } }
        a.remove();
      }
    };
    return api3d;
  });

  if (glOK) window.MPCityActor = "3d";
})();
