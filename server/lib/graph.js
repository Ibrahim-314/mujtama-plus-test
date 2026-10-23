/* Relationship-graph primitives for manipulation analysis (Phase 32). Pure, dependency-free and
 * deterministic so they can be unit-tested and run inside a scheduled job on bounded subgraphs.
 *  • WGraph: undirected weighted multigraph keyed by node id, edge weights summed per kind.
 *  • components(): union-find over edges whose weight passes a threshold.
 *  • labelPropagation(): deterministic community detection (degree-damped votes, ties → smallest label).
 *  • density / conductance / reciprocity: how closed and inward-looking a cluster is.
 *  • suspiciousClusters(): dense, inward-looking groups (e.g. new accounts that all follow and
 *    react to each other) ranked by a 0..1 score. Heuristic: it ranks for human review, it never decides. */

class WGraph {
  constructor() {
    /** @type {Map<string, Map<string, {w: number, kinds: Record<string, number>}>>} */
    this.adj = new Map();
  }
  addNode(a) {
    if (!this.adj.has(a)) this.adj.set(a, new Map());
    return this;
  }
  addEdge(a, b, w = 1, kind = "edge") {
    if (!a || !b || a === b) return this;
    this.addNode(a).addNode(b);
    for (const [x, y] of [
      [a, b],
      [b, a]
    ]) {
      const m = this.adj.get(x);
      const e = m.get(y) || { w: 0, kinds: {} };
      e.w += w;
      e.kinds[kind] = (e.kinds[kind] || 0) + w;
      m.set(y, e);
    }
    return this;
  }
  nodes() {
    return [...this.adj.keys()].sort();
  }
  weight(a, b) {
    return this.adj.get(a)?.get(b)?.w || 0;
  }
  degree(a) {
    let s = 0;
    for (const e of (this.adj.get(a) || new Map()).values()) s += e.w;
    return s;
  }
  /** each undirected edge once: [a, b, w, kinds] with a < b, sorted by (a, b)
   * @returns {Array<[string, string, number, Record<string, number>]>} */
  edges() {
    /** @type {Array<[string, string, number, Record<string, number>]>} */
    const out = [];
    for (const [a, m] of this.adj) for (const [b, e] of m) if (a < b) out.push([a, b, e.w, e.kinds]);
    return out.sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1));
  }
}

/** connected components using only edges with weight >= minWeight; singletons are dropped */
function components(g, minWeight = 0) {
  const parent = new Map();
  const find = x => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const n of g.nodes()) parent.set(n, n);
  for (const [a, b, w] of g.edges()) {
    if (w < minWeight) continue;
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const groups = new Map();
  for (const n of g.nodes()) {
    const r = find(n);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n);
  }
  return [...groups.values()]
    .filter(c => c.length > 1)
    .map(c => c.sort())
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}

/** deterministic weighted label propagation; returns clusters (arrays of node ids, size >= 1) */
function labelPropagation(g, { iterations = 20 } = {}) {
  const nodes = g.nodes();
  const label = new Map(nodes.map(n => [n, n]));
  const deg = new Map(nodes.map(n => [n, g.degree(n) || 1]));
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (const n of nodes) {
      const score = new Map();
      // votes are damped by the voter's degree so a bridge node cannot drag a whole clique across
      for (const [m, e] of g.adj.get(n)) score.set(label.get(m), (score.get(label.get(m)) || 0) + e.w / deg.get(m));
      if (!score.size) continue;
      let best = label.get(n),
        bw = -1;
      for (const [l, w] of [...score.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (w > bw) ((best = l), (bw = w));
      if (best !== label.get(n)) {
        label.set(n, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groups = new Map();
  for (const n of nodes) {
    const l = label.get(n);
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l).push(n);
  }
  return [...groups.values()].map(c => c.sort()).sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}

/** directed density of a node set given directed edges [[src,dst],...]: m / (n(n-1)) */
function density(nodes, directed) {
  const set = new Set(nodes),
    n = set.size;
  if (n < 2) return 0;
  const seen = new Set();
  for (const [s, d] of directed) if (s !== d && set.has(s) && set.has(d)) seen.add(s + "\u0000" + d);
  return seen.size / (n * (n - 1));
}

/** share of directed edges inside the set that are reciprocated */
function reciprocity(nodes, directed) {
  const set = new Set(nodes),
    e = new Set();
  for (const [s, d] of directed) if (set.has(s) && set.has(d) && s !== d) e.add(s + "\u0000" + d);
  if (!e.size) return 0;
  let r = 0;
  for (const k of e) {
    const [s, d] = k.split("\u0000");
    if (e.has(d + "\u0000" + s)) r++;
  }
  return r / e.size;
}

/** conductance of a cluster in an undirected weighted graph: cut / min(vol(S), vol(V\S)). Low = inward-looking */
function conductance(g, cluster) {
  const S = new Set(cluster);
  let cut = 0,
    volS = 0,
    volAll = 0;
  for (const [a, m] of g.adj)
    for (const [b, e] of m) {
      volAll += e.w;
      if (S.has(a)) {
        volS += e.w;
        if (!S.has(b)) cut += e.w;
      }
    }
  const denom = Math.min(volS, volAll - volS);
  return denom > 0 ? cut / denom : volS > 0 ? 0 : 1;
}

/** counts how often each pair of actors appears together in a group; returns Map "a|b" -> count (a < b) */
function coOccurrence(groups, { maxGroup = 60 } = {}) {
  const pairs = new Map();
  for (const grp of groups) {
    const g = [...new Set(grp)].sort().slice(0, maxGroup);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) pairs.set(g[i] + "|" + g[j], (pairs.get(g[i] + "|" + g[j]) || 0) + 1);
  }
  return pairs;
}

/**
 * Dense, inward-looking clusters in a follow/interaction graph.
 * @param {WGraph} g undirected interaction graph (follow + reaction + comment edges)
 * @param {Array<[string,string]>} directed directed follow edges for density/reciprocity
 * @param {{minSize?: number, minDensity?: number, maxConductance?: number}} [opts]
 */
function suspiciousClusters(g, directed, { minSize = 4, minDensity = 0.5, maxConductance = 0.35 } = {}) {
  const out = [];
  for (const c of labelPropagation(g)) {
    if (c.length < minSize) continue;
    const d = density(c, directed),
      r = reciprocity(c, directed),
      phi = conductance(g, c);
    if (d < minDensity || phi > maxConductance) continue;
    const score = Math.min(1, 0.5 * d + 0.25 * r + 0.25 * (1 - phi) + Math.min(0.1, (c.length - minSize) * 0.01));
    out.push({ members: c, size: c.length, density: round(d), reciprocity: round(r), conductance: round(phi), score: round(score) });
  }
  return out.sort((a, b) => b.score - a.score);
}
const round = x => Math.round(x * 100) / 100;

module.exports = { WGraph, components, labelPropagation, density, reciprocity, conductance, coOccurrence, suspiciousClusters };
