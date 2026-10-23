/* مجتمع بلس — «المدينة» glowing route (city/trail.js). A tap draws a neon line along the streets from the character to the
 * spot (≈0.35 s), light pulses run along it toward the goal, and the line is eaten from behind as the character walks it.
 * A ring pulses where you tapped (gold at a building door). Reduced motion: the line and ring appear without animation. */
(function CityTrail() {
  "use strict";
  const { svg, reduced } = MPCity.util;
  const d = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");

  MPCity.use((city) => {
    const { layers, scene } = city, id = "cy-tg-" + scene.id + "-" + Math.random().toString(36).slice(2, 7);
    const defs = svg("defs");
    // the route is hidden where it runs behind a building (scene.occluders)
    const occ = (scene.occluders || []).map((poly) => `<polygon points="${poly.map((p) => p.join(",")).join(" ")}" fill="#000"/>`).join("");
    defs.innerHTML = `<mask id="${id}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="${scene.size[0]}" height="${scene.size[1]}"><rect width="${scene.size[0]}" height="${scene.size[1]}" fill="#fff"/>${occ}</mask>`;
    const g = svg("g", { class: "cy-trail", mask: `url(#${id}-m)` });
    // gold street light: a wide soft halo, the amber line, a thin white core, and white dots running toward the goal
    const halo = svg("path", { class: "cy-trail-halo" });
    const line = svg("path", { class: "cy-trail-line" });
    const core = svg("path", { class: "cy-trail-core" });
    const pulse = svg("path", { class: "cy-trail-pulse" });
    const chev = svg("g", { class: "cy-chev" });
    const ring = svg("g", { class: "cy-ring" });
    ring.innerHTML = `<circle class="cy-ring-a" r="22"/><circle class="cy-ring-b" r="22"/><circle class="cy-ring-c" r="5"/>`;
    const miss = svg("circle", { class: "cy-miss", r: "18" });
    g.append(halo, line, core, pulse, chev); layers.fx.append(defs, g, ring, miss);

    let L = 0, pts = [];
    const set = (n, k, v) => n.style.setProperty(k, v);
    function show(r, goal) {
      const path = d(r.points); L = Math.max(1, r.length); pts = r.points;
      for (const n of [halo, line, core, pulse]) n.setAttribute("d", path);
      // direction chevrons every ~52 px along the way (none in the first and last stretch)
      chev.textContent = "";
      for (let at = 44; at < L - 30; at += 52) {
        const a = MPCityPath.at(r.points, at); if (!a) continue;
        const c = svg("path", { d: "M -5 -6 L 3 0 L -5 6", transform: `translate(${a.point[0].toFixed(1)} ${a.point[1].toFixed(1)}) rotate(${((a.angle * 180) / Math.PI).toFixed(1)})` });
        c._at = at; chev.append(c);
      }
      const end = r.points[r.points.length - 1];
      ring.setAttribute("transform", `translate(${end[0].toFixed(1)} ${end[1].toFixed(1)})`);
      ring.classList.toggle("gold", !!(goal && goal.place)); ring.style.setProperty("--cy-acc", (goal && goal.place && goal.place.accent) || "#ffcf5a");
      g.classList.remove("on", "fade"); ring.classList.remove("on");
      // draw in: the whole line from the character to the goal
      for (const n of [halo, line, core]) { n.style.transition = "none"; set(n, "stroke-dasharray", `${L} ${L}`); set(n, "stroke-dashoffset", String(L)); }
      void g.getBoundingClientRect();
      g.classList.add("on"); ring.classList.add("on");
      const ms = reduced() ? 0 : Math.min(420, 160 + L * 0.5);
      for (const n of [halo, line, core]) { n.style.transition = ms ? `stroke-dashoffset ${ms}ms cubic-bezier(.2,.7,.2,1)` : "none"; set(n, "stroke-dashoffset", "0"); }
    }
    // the walked part disappears behind the character: a single dash that starts at s
    function eat(s) { for (const n of [halo, line, core, pulse]) n.style.transition = "none"; const rest = Math.max(0, L - s); for (const c of chev.children) if (c._at < s + 8) c.style.opacity = "0"; for (const n of [halo, line, core]) { set(n, "stroke-dasharray", `${rest} ${L + 1}`); set(n, "stroke-dashoffset", String(-s)); } 
      // the travelling light pulses only run on the part still ahead (the path is rebuilt from where the character is)
      const a = MPCityPath.at(pts, s); if (a && rest > 4) { pulse.setAttribute("d", d([a.point, ...pts.slice(a.segment + 1)])); pulse.style.opacity = ""; } else pulse.style.opacity = "0"; }
    function done() { g.classList.add("fade"); ring.classList.remove("on"); }

    let drawing = 0;
    city.on("walk", (r, goal) => { show(r, goal); drawing = performance.now(); });
    // keep the drawn-in line whole for its first moments, then start eating it
    city.on("step", (s) => { if (performance.now() - drawing > 260 || reduced()) eat(s); });
    city.on("arrive", () => done());
    city.on("tap", (t) => {
      if (t.kind !== "miss") return;
      miss.setAttribute("cx", t.at[0].toFixed(1)); miss.setAttribute("cy", t.at[1].toFixed(1));
      miss.classList.remove("on"); void miss.getBoundingClientRect(); miss.classList.add("on");
    });
  });
})();
