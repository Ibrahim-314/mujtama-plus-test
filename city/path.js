/* مجتمع بلس — «المدينة» street graph (city/path.js). Pure geometry, no DOM: unit-tested in tests/unit/city-path.test.js.
 * A scene's streets are a graph of nodes (points in scene pixels) and edges (straight street segments). A tap anywhere is
 * snapped to the closest point on a street; the walk is the shortest route along the streets (Dijkstra) from where the
 * character stands — which may be the middle of a segment — to that point. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MPCityPath = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /** Build a graph from { nodes: {id:[x,y]}, edges: [[a,b]] }. Unknown ids or zero-length edges are dropped. */
  function graph(def) {
    const nodes = {}, adj = {}, edges = [];
    for (const [id, p] of Object.entries((def && def.nodes) || {})) { if (Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])) { nodes[id] = [+p[0], +p[1]]; adj[id] = []; } }
    for (const e of (def && def.edges) || []) {
      const [a, b] = e || []; if (!nodes[a] || !nodes[b] || a === b) continue;
      const len = dist(nodes[a], nodes[b]); if (!(len > 0)) continue;
      const i = edges.push({ a, b, len }) - 1; adj[a].push(i); adj[b].push(i);
    }
    return { nodes, edges, adj };
  }

  /** Closest point on segment ab to p → { t (0..1), point, d } */
  function project(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const point = [a[0] + dx * t, a[1] + dy * t]; return { t, point, d: dist(p, point) };
  }

  /** Snap a point to the nearest street: { edge, t, point, d } or null for an empty graph. */
  function snap(g, p) {
    let best = null;
    g.edges.forEach((e, i) => { const r = project(p, g.nodes[e.a], g.nodes[e.b]); if (!best || r.d < best.d) best = { edge: i, t: r.t, point: r.point, d: r.d }; });
    return best;
  }

  /** A location on the graph: { edge, t }. A node id is also accepted. Returns its point. */
  function pointOf(g, loc) {
    if (typeof loc === "string") return g.nodes[loc] ? g.nodes[loc].slice() : null;
    const e = g.edges[loc.edge]; if (!e) return null; const a = g.nodes[e.a], b = g.nodes[e.b];
    return [a[0] + (b[0] - a[0]) * loc.t, a[1] + (b[1] - a[1]) * loc.t];
  }

  /* Dijkstra over the real nodes plus two virtual ones (start "@s", goal "@g") spliced into their edges. Small graphs
   * (tens of nodes) → a plain O(n²) scan is faster and simpler than a heap. */
  function route(g, from, to) {
    const P = (loc) => pointOf(g, loc), sp = P(from), gp = P(to); if (!sp || !gp) return null;
    const links = {}; const link = (u, v, w) => { (links[u] ||= []).push([v, w]); (links[v] ||= []).push([u, w]); };
    for (const id in g.nodes) links[id] ||= [];
    g.edges.forEach((e, i) => {
      const cut = [];
      if (typeof from === "object" && from.edge === i) cut.push({ id: "@s", t: from.t });
      if (typeof to === "object" && to.edge === i) cut.push({ id: "@g", t: to.t });
      if (!cut.length) return link(e.a, e.b, e.len);
      cut.sort((x, y) => x.t - y.t);
      let prev = e.a, pt = 0;
      for (const c of cut) { link(prev, c.id, e.len * (c.t - pt)); prev = c.id; pt = c.t; }
      link(prev, e.b, e.len * (1 - pt));
      if (cut.length === 2) link(cut[0].id, cut[1].id, e.len * (cut[1].t - cut[0].t)); // same street: walk straight along it
    });
    const S = typeof from === "string" ? from : "@s", G = typeof to === "string" ? to : "@g";
    const pos = (id) => (id === "@s" ? sp : id === "@g" ? gp : g.nodes[id]);
    const D = {}, prev = {}, done = new Set(); for (const id in links) D[id] = Infinity; D[S] = 0;
    for (;;) {
      let u = null; for (const id in D) if (!done.has(id) && D[id] < Infinity && (u === null || D[id] < D[u])) u = id;
      if (u === null || u === G) break; done.add(u);
      for (const [v, w] of links[u] || []) if (D[u] + w < D[v]) { D[v] = D[u] + w; prev[v] = u; }
    }
    if (!(D[G] < Infinity)) return null;
    const ids = [G]; while (ids[0] !== S) ids.unshift(prev[ids[0]]);
    const points = ids.map((id) => pos(id).slice());
    // drop repeated points (a tap exactly on a node)
    const clean = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 0.01);
    return { nodes: ids, points: clean, length: D[G] };
  }

  /** Total length of a polyline */
  const length = (pts) => pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]) : 0), 0);

  /** Point and heading at distance s along a polyline → { point, angle (radians, screen space), segment } */
  function at(pts, s) {
    if (!pts.length) return null; if (pts.length === 1) return { point: pts[0].slice(), angle: 0, segment: 0 };
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = dist(pts[i - 1], pts[i]);
      if (acc + L >= s || i === pts.length - 1) {
        const t = L ? Math.max(0, Math.min(1, (s - acc) / L)) : 1, a = pts[i - 1], b = pts[i];
        return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], angle: Math.atan2(b[1] - a[1], b[0] - a[0]), segment: i - 1 };
      }
      acc += L;
    }
    return null;
  }

  /** Where on the graph a point lies (for a character standing at p after a walk) */
  const locate = (g, p) => { const s = snap(g, p); return s ? { edge: s.edge, t: s.t } : null; };

  /** Point-in-polygon (even-odd), for building hit areas drawn as polygons */
  function inside(p, poly) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  }

  /** Validate a scene definition; returns a list of problems (empty = fine). Used by tests and the debug overlay. */
  function check(scene) {
    const out = [], g = graph(scene.streets || {});
    if (!Object.keys(g.nodes).length) out.push("no street nodes");
    const ids = Object.keys(g.nodes), seen = new Set([ids[0]]), q = [ids[0]];
    while (q.length) { const u = q.shift(); for (const i of g.adj[u] || []) { const e = g.edges[i], v = e.a === u ? e.b : e.a; if (!seen.has(v)) { seen.add(v); q.push(v); } } }
    for (const id of ids) if (!seen.has(id)) out.push("node not connected: " + id);
    for (const b of scene.places || []) {
      if (!g.nodes[b.door]) out.push(b.id + ": door node missing " + b.door);
      if (!Array.isArray(b.area) || b.area.length < 3) out.push(b.id + ": hit area needs 3+ points");
      if (!b.label || !b.label.ar || !b.label.en) out.push(b.id + ": label ar/en missing");
    }
    return out;
  }

  /** Round the corners of a polyline: each inner corner becomes a short curve of radius ≤ r (never more than half of
   * either segment), sampled every few px so walking and drawing follow the same smooth line. → { points, length } */
  function smooth(pts, r) {
    if (!pts || pts.length < 3 || !(r > 0)) return { points: (pts || []).map((p) => p.slice()), length: length(pts || []) };
    const out = [pts[0].slice()];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1], l1 = dist(a, b), l2 = dist(b, c);
      const k = Math.min(r, l1 / 2, l2 / 2); if (!(k > 0.5)) { out.push(b.slice()); continue; }
      const p0 = [b[0] + ((a[0] - b[0]) * k) / l1, b[1] + ((a[1] - b[1]) * k) / l1], p2 = [b[0] + ((c[0] - b[0]) * k) / l2, b[1] + ((c[1] - b[1]) * k) / l2];
      const n = Math.max(3, Math.ceil(k / 4));
      for (let j = 0; j <= n; j++) { const t = j / n, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]); }
    }
    out.push(pts[pts.length - 1].slice());
    const clean = out.filter((p, i) => !i || dist(p, out[i - 1]) > 0.01);
    return { points: clean, length: length(clean) };
  }

  return { graph, project, snap, pointOf, route, length, at, locate, inside, check, dist, smooth };
});
