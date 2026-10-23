/* مجتمع بلس — «المدينة» calibration overlay (city/debug.js), only with #/town?debug=1. Draws the street graph, the
 * building tap areas and the sign boards over the art, lists the scene's problems (MPCityPath.check), and prints the
 * scene coordinates of every tap so the data in city/scenes/*.js can be tuned by eye on a real phone. */
(function CityDebug() {
  "use strict";
  const { svg, el, esc } = MPCity.util;
  MPCity.use((city) => {
    if (!city.opts.debug) return;
    const { scene, graph: g, layers } = city, N = g.nodes;
    const grp = svg("g", { class: "cy-dbg" });
    for (const e of g.edges) grp.append(svg("line", { x1: N[e.a][0], y1: N[e.a][1], x2: N[e.b][0], y2: N[e.b][1] }));
    for (const id in N) { grp.append(svg("circle", { cx: N[id][0], cy: N[id][1], r: 7 })); const t = svg("text", { x: N[id][0] + 9, y: N[id][1] - 8 }); t.textContent = id; grp.append(t); }
    for (const pl of scene.places || []) {
      grp.append(svg("polygon", { class: "a", points: pl.area.map((p) => p.join(",")).join(" ") }));
      if (pl.sign) { const [tl, tr, bl] = pl.sign, br = [tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1]]; grp.append(svg("polygon", { class: "s", points: [tl, tr, br, bl].map((p) => p.join(",")).join(" ") })); }
    }
    layers.fx.append(grp);
    const out = el("pre", "cy-dbg-out"); const probs = MPCityPath.check(scene);
    out.textContent = (probs.length ? "! " + probs.join("\n! ") : "scene ok") + "\n";
    city.root.parentNode.append(out);
    city.on("tap", (t) => { const p = (t.at || t.point || [0, 0]).map(Math.round); out.textContent += `${t.kind}${t.place ? " " + t.place.id : ""} [${p[0]}, ${p[1]}]\n`; out.scrollTop = 1e9; });
    city.on("destroy", () => out.remove());
    void esc;
  });
})();
