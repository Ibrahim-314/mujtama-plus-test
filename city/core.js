/* مجتمع بلس — «المدينة» engine core (city/core.js), first file of the lazy "town" chunk.
 *
 * The city is a still, hand-made isometric scene (art) with live layers on top: neon signs and lights that breathe, a
 * glowing route that draws itself from the character to where you tapped, and the character walking it. Tapping a
 * building walks to its door, steps in, and opens that building's own system through the portal transition.
 *
 * window.MPCity
 *   mount(el, { scene: "main", place: "profile"|"page", debug }) → city instance { walkTo(placeId), destroy() }
 *   use(feature)            feature(city) runs on every mount (lights, trail, portal, debug are features)
 *   actor(name, factory)    register a character renderer; "token" ships now, "3d" arrives with the character step
 *   util                    shared helpers (T, esc, lang, reduced, el, svg)
 *
 * Layers (bottom → top) inside .cy-stage (direction-neutral: dir=ltr, scene pixels map to % of the stage):
 *   .cy-art (img) → .cy-lights (glow spots) → svg.cy-fx (signs, trail, marker) → .cy-actors → svg.cy-hit (tap areas)
 * One rAF loop runs only while something moves; everything pauses when the stage is off-screen. */
(function MPCityCore() {
  "use strict";
  const P = window.MPCityPath, NS = "http://www.w3.org/2000/svg";
  const features = [], actors = {};
  const T = (x) => (window.MPI18n && MPI18n.t ? MPI18n.t(x) : x);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lang = () => (document.documentElement.lang === "en" ? "en" : "ar");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, attrs) => { const n = document.createElement(tag); if (cls) n.className = cls; for (const k in attrs || {}) n.setAttribute(k, attrs[k]); return n; };
  const svg = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs || {}) n.setAttribute(k, attrs[k]); return n; };
  const label = (place) => (place.label && place.label[lang()]) || (place.label && place.label.ar) || place.id;
  const util = { T, esc, lang, reduced, el, svg, label, NS };

  function mount(host, opts) {
    opts = opts || {};
    const scene = (window.MPCityScenes || {})[opts.scene || "main"]; if (!host || !scene) return null;
    const [W, H] = scene.size, g = P.graph(scene.streets);
    const pct = (p) => [(p[0] / W) * 100, (p[1] / H) * 100];
    const hooks = { lang: [], tap: [], walk: [], step: [], arrive: [], enter: [], resize: [], destroy: [], visible: [] };
    const on = (k, fn) => { hooks[k].push(fn); };
    const emit = (k, ...a) => { for (const fn of hooks[k]) { try { fn(...a); } catch (e) { console.error("[MPCity]", k, e); } } };

    /* ---- DOM ---- */
    const root = el("div", "cy-stage", { dir: "ltr", role: "group", "aria-roledescription": T("مدينة"), "aria-label": T("مدينتك") });
    root.style.setProperty("--cy-tone", scene.art.tone || "#1b1626");
    root.style.aspectRatio = W + " / " + H; root.style.setProperty("--cy-ar", String(W / H)); root.classList.toggle("cy-tall", H > W);
    for (const k in scene.palette || {}) host.style.setProperty(k, scene.palette[k]); // the frame, the stage and the hint share it
    const art = el("img", "cy-art", { alt: "", decoding: "async", draggable: "false", width: String(W), height: String(H),
      src: scene.art.src, srcset: `${scene.art.small} ${scene.art.smallW || 640}w, ${scene.art.src} ${W}w`, sizes: "(max-width: 700px) 100vw, 640px" });
    art.addEventListener("load", () => root.classList.add("cy-ready"), { once: true });
    if (art.complete) root.classList.add("cy-ready");
    const lights = el("div", "cy-lights", { "aria-hidden": "true" });
    const fx = svg("svg", { class: "cy-fx", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", preserveAspectRatio: "xMidYMid meet" });
    const actorsLayer = el("div", "cy-actors", { "aria-hidden": "true" });
    const hit = svg("svg", { class: "cy-hit", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet" });
    root.append(art, lights, fx, actorsLayer, hit);
    host.append(root);

    /* ---- the character ---- */
    const saved = (() => { try { return JSON.parse(sessionStorage.getItem("mp.city.at." + scene.id) || "null"); } catch { return null; } })();
    const startPoint = saved && Array.isArray(saved) ? saved : P.pointOf(g, scene.start) || [W / 2, H / 2];
    const state = { point: startPoint.slice(), angle: Math.PI / 4, moving: false, route: null, s: 0, goal: null, raf: 0, last: 0, visible: true, destroyed: false };
    let city = null; // filled once the stage is built (draw() runs before that, with the first actor)
    const make = actors[opts.actor || window.MPCityActor || "token"] || actors.token; // the character step registers "3d" and sets MPCityActor
    const actor = make ? make(actorsLayer, { util, scene, opts }) : null;
    // behind a building (an occluder) the character and the route are hidden: the alley runs behind it
    const occ = scene.occluders || [];
    let hid = false;
    const place = (p) => { const [x, y] = pct(p); actorsLayer.style.setProperty("--x", x + "%"); actorsLayer.style.setProperty("--y", y + "%");
      const h = occ.some((poly) => P.inside(p, poly)); if (h !== hid) { hid = h; actorsLayer.classList.toggle("cy-hid", h); } };
    place(state.point);
    const draw = () => { const a = (city && city.actor) || actor; if (a) a.update({ x: state.point[0], y: state.point[1], angle: state.angle, moving: state.moving, W, H }); };
    draw();

    /* ---- walking ---- */
    function stop(arrived) {
      state.moving = false; cancelAnimationFrame(state.raf); state.raf = 0; draw();
      try { sessionStorage.setItem("mp.city.at." + scene.id, JSON.stringify(state.point.map((v) => Math.round(v)))); } catch { }
      const goal = state.goal; state.goal = null; state.route = null;
      if (arrived && goal) emit("arrive", goal, city);
    }
    function frame(t) {
      if (state.destroyed) return;
      const dt = Math.min(0.05, (t - (state.last || t)) / 1000); state.last = t;
      const r = state.route; if (!r) return stop(false);
      state.s = Math.min(r.length, state.s + (scene.speed || 150) * dt);
      const a = P.at(r.points, state.s); if (a) { state.point = a.point; state.angle = a.angle; }
      place(state.point); draw(); emit("step", state.s, r, city);
      if (state.s >= r.length - 0.01) return stop(true);
      state.raf = requestAnimationFrame(frame);
    }
    /** Walk to a street location ({edge,t} | node id). goal: { kind: "place", place } | { kind: "street" } */
    function walk(to, goal) {
      const from = P.locate(g, state.point); if (!from) return false;
      let r = P.route(g, from, to); if (!r) return false;
      // a route always starts exactly where the character stands (it may stand a hair off the street after a resize)
      if (P.dist(r.points[0], state.point) > 0.5) r = { ...r, points: [state.point.slice(), ...r.points], length: r.length + P.dist(r.points[0], state.point) };
      // rounded corners: the walk and the drawn route follow the same smooth line
      if (scene.corner) r = { ...r, ...P.smooth(r.points, scene.corner) };
      state.route = r; state.s = 0; state.goal = goal || null;
      emit("walk", r, goal, city);
      if (reduced() || r.length < 1) { // no walking animation: arrive in place
        state.point = r.points[r.points.length - 1].slice(); place(state.point); emit("step", r.length, r, city); stop(true); return true;
      }
      state.moving = true; draw(); cancelAnimationFrame(state.raf); state.last = 0; state.raf = requestAnimationFrame(frame);
      return true;
    }
    const placeById = (id) => (scene.places || []).find((p) => p.id === id);
    function walkTo(id) { const pl = placeById(id); return pl ? walk(pl.door, { kind: "place", place: pl }) : false; }

    /* ---- taps ---- */
    const toScene = (ev) => { const b = root.getBoundingClientRect(); return [((ev.clientX - b.left) / b.width) * W, ((ev.clientY - b.top) / b.height) * H]; };
    const areas = (scene.places || []).map((pl) => {
      const poly = svg("polygon", { points: pl.area.map((p) => p.join(",")).join(" "), class: "cy-area", tabindex: "0", role: "button", "data-place": pl.id, "aria-label": T("ادخل") + " " + label(pl) });
      poly.style.setProperty("--cy-acc", pl.accent || "#a875ff");
      poly.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); emit("tap", { kind: "place", place: pl, point: P.pointOf(g, pl.door) }, city); walkTo(pl.id); } });
      hit.append(poly); return { pl, poly };
    });
    // the stage is inside a scrolling page: a click is a tap (a scroll never fires one)
    hit.addEventListener("click", (ev) => {
      const p = toScene(ev), target = ev.target && ev.target.closest ? ev.target.closest("[data-place]") : null;
      const pl = target ? placeById(target.getAttribute("data-place")) : (scene.places || []).find((x) => P.inside(p, x.area));
      if (pl) { emit("tap", { kind: "place", place: pl, point: P.pointOf(g, pl.door), at: p }, city); walkTo(pl.id); return; }
      const s = P.snap(g, p);
      if (!s || s.d > (scene.reach || 90)) { emit("tap", { kind: "miss", at: p }, city); return; }
      emit("tap", { kind: "street", point: s.point, at: p }, city); walk({ edge: s.edge, t: s.t }, { kind: "street" });
    });

    /* ---- visibility: pause everything off-screen ---- */
    let io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver((ents) => { for (const e of ents) { state.visible = e.isIntersecting; root.classList.toggle("cy-off", !state.visible); emit("visible", state.visible, city); } }, { threshold: 0.05 });
      io.observe(root);
    }
    const ro = "ResizeObserver" in window ? new ResizeObserver(() => emit("resize", root.getBoundingClientRect(), city)) : null; if (ro) ro.observe(root);

    /* interface language switched while the city is on screen: features re-label themselves (signs, tap areas) */
    let langNow = lang();
    const mo = new MutationObserver(() => { if (lang() !== langNow) { langNow = lang(); for (const { pl, poly } of areas) poly.setAttribute("aria-label", T("ادخل") + " " + label(pl)); root.setAttribute("aria-label", T("مدينتك")); emit("lang", langNow, city); } });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    on("destroy", () => mo.disconnect());

    function destroy() {
      if (state.destroyed) return; state.destroyed = true; cancelAnimationFrame(state.raf);
      if (io) io.disconnect(); if (ro) ro.disconnect(); emit("destroy", city); if (city.actor && city.actor.destroy) city.actor.destroy(); root.remove();
    }

    /** replace the character (the member picked another one): same spot, same state */
    function setActor(name) {
      const mk = actors[name] || actors.token; if (!mk) return;
      if (city.actor && city.actor.destroy) city.actor.destroy();
      city.actor = mk(actorsLayer, { util, scene, opts }); if (city.actor.bind) city.actor.bind(city); draw();
    }
    city = { setActor, scene, graph: g, root, layers: { art, lights, fx, actors: actorsLayer, hit }, areas, state, opts, on, emit, walk, walkTo, place: placeById, pct, util, destroy, actor };
    if (actor && actor.bind) { try { actor.bind(city); } catch (e) { console.error("[MPCity] actor", e); } }
    for (const f of features) { try { f(city); } catch (e) { console.error("[MPCity] feature", e); } }
    // a page that drops the stage from the DOM (route change) must not leave a loop running
    // (checked on navigation and whenever the stage leaves the screen — no document-wide MutationObserver)
    const gone = () => { if (!root.isConnected) { removeEventListener("hashchange", later); destroy(); } };
    const later = () => setTimeout(gone, 0);
    if (!opts.keepAlive) { addEventListener("hashchange", later); on("visible", (v) => { if (!v) later(); }); } // the profile slot is moved, not rebuilt
    on("destroy", () => removeEventListener("hashchange", later));
    return city;
  }

  window.MPCity = { mount, use: (f) => { features.push(f); }, actor: (name, make) => { actors[name] = make; }, util, version: "1.0" };
})();
