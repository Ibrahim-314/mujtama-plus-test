/* مجتمع بلس — «المدينة» live lights (city/lights.js): neon sign labels drawn into the empty boards of the art, and glow
 * spots over windows/lamps that breathe. Pure SVG + CSS animations (compositor-only opacity), each with its own rhythm so
 * the city never pulses in lockstep. Reduced motion: steady glow, no flicker. Off-screen: paused by .cy-off. */
(function CityLights() {
  "use strict";
  const { svg, el, label } = MPCity.util;
  // a tiny deterministic random per scene element, so the rhythm is the same on every visit (no layout jitter)
  const rnd = (seed) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };

  /* the label's size: as large as the board allows (52% of its height), never wider than 76% of it. Measured with the
   * real face (Cairo 800, shipped with the chunk) once it has loaded; a close estimate before that. */
  const FONT = "MPCityCairo";
  let meter = null;
  const measure = (txt) => { try { meter = meter || document.createElement("canvas").getContext("2d"); meter.font = `800 100px ${FONT}, sans-serif`; return meter.measureText(txt).width / 100; } catch { return 0; } };
  const fontReady = () => !!(document.fonts && document.fonts.check && document.fonts.check(`800 20px ${FONT}`));
  const fit = (txt, w, h) => { const em = (fontReady() && measure(txt)) || Math.max(3, txt.length) * (/[a-z]/i.test(txt) ? 0.58 : 0.5); return Math.min(h * 0.52, (w * 0.76) / em); };
  const LAYERS = [["cy-sign-g2", 0.34], ["cy-sign-g1", 0.17], ["cy-sign-h", 0.075]]; // soft halo → tube glow → tube; the core is .cy-sign-t
  MPCity.use((city) => {
    const { scene, layers } = city;
    /* no SVG filter: a filtered group re-rasterises on every animated frame (heavy on Pi Browser). The halo is a second copy
     * of the label with a wide, soft, translucent accent stroke under the crisp one — same look, compositor-only animation. */
    const signs = svg("g", { class: "cy-signs" });
    // one label = the same text four times, widest stroke first (no SVG filter: compositor-friendly on Pi Browser)
    function labelNodes(txt, x, y, fs) {
      const dir = MPCity.util.lang() === "ar" ? "rtl" : "ltr", out = [];
      for (const [cls, k] of [...LAYERS, ["cy-sign-t", 0]]) {
        const t = svg("text", { class: cls, x: x.toFixed(1), y: (y + fs * 0.06).toFixed(1), "font-size": fs.toFixed(1), "text-anchor": "middle", "dominant-baseline": "central", direction: dir });
        if (k) t.style.strokeWidth = (fs * k).toFixed(2);
        t.textContent = txt; out.push(t);
      }
      return out;
    }
    /* animated neon frames (scene.frames — the MJT hall): the board's own tube breathes in its colour and two runners of
     * light chase round it. pathLength=1000 lets one CSS keyframe drive every board whatever its size; each board has its
     * own phase. Opacity + dash offset only, no filter. Reduced motion: a steady glow, no runners. */
    if (scene.frames) {
      const frames = svg("g", { class: "cy-frames" });
      (scene.places || []).forEach((pl, i) => {
        if (!pl.sign) return;
        const [tl, tr, bl] = pl.sign, br = [tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1]];
        const d = "M" + [tl, tr, br, bl].map((p) => p.join(" ")).join(" L") + " Z";
        const h = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]), sw = Math.max(3, h * 0.06);
        const g = svg("g", { class: "cy-frame-n", "data-place": pl.id });
        g.style.setProperty("--cy-acc", pl.accent || "#a875ff"); g.style.setProperty("--cy-d", (-rnd(i + 31) * 2.2).toFixed(2) + "s");
        const glow = svg("path", { d, class: "cy-fr-glow" }); glow.style.strokeWidth = (sw * 4).toFixed(1); g.append(glow);
        for (const off of [0, 500]) for (const [cls, k] of [["cy-fr-run-g", 2.6], ["cy-fr-run", 0.9]]) {
          const r = svg("path", { d, class: cls + (off ? " b" : ""), pathLength: "1000", "stroke-dasharray": "90 910", "stroke-dashoffset": String(-off) });
          r.style.strokeWidth = (sw * k).toFixed(1); g.append(r);
        }
        frames.append(g);
      });
      layers.fx.append(frames);
    }
    (scene.places || []).forEach((pl, i) => {
      const acc = pl.accent || "#a875ff";
      if (pl.sign) {
        const [tl, tr, bl] = pl.sign, wx = tr[0] - tl[0], wy = tr[1] - tl[1], hx = bl[0] - tl[0], hy = bl[1] - tl[1];
        const w = Math.hypot(wx, wy), h = Math.hypot(hx, hy);
        // affine map of a w×h box onto the board: text keeps its proportions, only follows the board's slant
        const m = [wx / w, wy / w, hx / h, hy / h, tl[0], tl[1]].map((v) => +v.toFixed(4)).join(" ");
        const txt = label(pl), fs = fit(txt, w, h);
        const grp = svg("g", { class: "cy-sign", transform: `matrix(${m})`, "data-place": pl.id });
        grp.style.setProperty("--cy-acc", acc);
        grp.style.setProperty("--cy-d", (rnd(i + 1) * 6).toFixed(2) + "s"); grp.style.setProperty("--cy-p", (5 + rnd(i + 7) * 6).toFixed(2) + "s");
        grp.append(...labelNodes(txt, w / 2, h / 2, fs)); grp._wh = [w, h]; signs.append(grp);
      } else if (pl.tag) { // a place with no board (the tree): a floating neon tag above it
        const g2 = svg("g", { class: "cy-sign cy-tag", transform: `translate(${pl.tag[0]} ${pl.tag[1]})`, "data-place": pl.id });
        g2.style.setProperty("--cy-acc", acc); g2.style.setProperty("--cy-d", (rnd(i + 3) * 5).toFixed(2) + "s"); g2.style.setProperty("--cy-p", "6s");
        g2.append(...labelNodes(label(pl), 0, 0, 30)); signs.append(g2);
      }
    });
    layers.fx.append(signs);

    // glow spots: absolutely positioned radial gradients, mix-blend screen, breathing at their own pace
    (scene.lights || []).forEach(([x, y, r], i) => {
      const s = el("span", "cy-light");
      const near = (scene.places || []).find((pl) => MPCityPath.inside([x, y], pl.area));
      s.style.cssText = `--l:${(x / scene.size[0]) * 100}%;--t:${(y / scene.size[1]) * 100}%;--r:${((r * 2) / scene.size[0]) * 100}%;--cy-acc:${(near && near.accent) || "#ffb86b"};--cy-d:${(rnd(i + 11) * 4).toFixed(2)}s;--cy-p:${(3.2 + rnd(i + 21) * 3).toFixed(2)}s`;
      layers.lights.append(s);
    });

    function relabel() {
      const L = MPCity.util.lang();
      for (const grp of signs.querySelectorAll(".cy-sign")) {
        const pl = city.place(grp.getAttribute("data-place")); if (!pl) continue; const txt = label(pl);
        const fs = grp._wh ? fit(txt, grp._wh[0], grp._wh[1]) : 30;
        for (const t of grp.querySelectorAll("text")) {
          t.textContent = txt; t.setAttribute("font-size", fs.toFixed(1)); t.setAttribute("direction", L === "ar" ? "rtl" : "ltr");
          if (grp._wh) t.setAttribute("y", (grp._wh[1] / 2 + fs * 0.06).toFixed(1));
          const k = (LAYERS.find(([c]) => t.classList.contains(c)) || [])[1]; if (k) t.style.strokeWidth = (fs * k).toFixed(2);
        }
      }
    }
    city.on("lang", relabel);
    // the real face lands a moment after the chunk: re-fit every board with its true metrics
    if (document.fonts && document.fonts.load && !fontReady()) document.fonts.load(`800 40px ${FONT}`, "مجتمع City").then(() => { if (fontReady()) relabel(); }, () => { });

    // neon glyphs drawn into empty boards (the play mark on the Vidtik tower)
    for (const m of scene.marks || []) {
      if (m.kind !== "play") continue;
      const z = m.size || 20, gm = svg("g", { class: "cy-sign cy-mark", transform: `translate(${m.at[0]} ${m.at[1]}) matrix(1 ${m.skew || 0} 0 1 0 0)` });
      gm.style.setProperty("--cy-acc", m.accent || "#ff4fd8"); gm.style.setProperty("--cy-p", "9s"); gm.style.setProperty("--cy-d", "2.4s");
      const d = `M ${-z * 0.62} ${-z} L ${z} 0 L ${-z * 0.62} ${z} Z`;
      for (const [cls, w] of [["cy-sign-g2", z * 0.7], ["cy-sign-g1", z * 0.34], ["cy-sign-h", z * 0.14], ["cy-sign-t", 0]]) {
        const p = svg("path", { class: cls, d, "stroke-linejoin": "round" }); if (w) p.style.strokeWidth = w.toFixed(1); gm.append(p);
      }
      signs.append(gm);
    }
    // the sign of the building you are heading to burns brighter
    city.on("walk", (r, goal) => { signs.querySelectorAll(".cy-sign.on").forEach((n) => n.classList.remove("on")); if (goal && goal.place) signs.querySelector(`.cy-sign[data-place="${goal.place.id}"]`)?.classList.add("on"); });
    city.on("arrive", (goal) => { if (!goal || !goal.place) signs.querySelectorAll(".cy-sign.on").forEach((n) => n.classList.remove("on")); });
  });
})();
