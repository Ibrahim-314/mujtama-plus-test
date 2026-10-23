/* v2.83 «المدينة» street graph (city/path.js) + the main scene data */
const test = require("node:test"), assert = require("node:assert");
const P = require("../../city/path.js");
const sq = P.graph({ nodes: { a: [0, 0], b: [100, 0], c: [100, 100], d: [0, 100], x: [500, 500] }, edges: [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"], ["a", "zz"], ["b", "b"]] });

test("graph drops unknown nodes and self loops", () => { assert.equal(sq.edges.length, 4); });
test("snap finds the nearest point on a street", () => {
  const s = P.snap(sq, [50, -20]); assert.equal(sq.edges[s.edge].a + sq.edges[s.edge].b, "ab"); assert.deepEqual(s.point, [50, 0]); assert.equal(s.d, 20);
});
test("route goes the short way round, from mid-street to mid-street", () => {
  const from = P.locate(sq, [50, 0]), to = P.locate(sq, [0, 50]);
  const r = P.route(sq, from, to); assert.ok(Math.abs(r.length - 100) < 1e-9, "50 to a + 50 down"); assert.deepEqual(r.points[0], [50, 0]); assert.deepEqual(r.points.at(-1), [0, 50]);
});
test("route on the same street walks straight along it", () => {
  const r = P.route(sq, { edge: 0, t: 0.2 }, { edge: 0, t: 0.9 }); assert.ok(Math.abs(r.length - 70) < 1e-9); assert.equal(r.points.length, 2);
});
test("route to a node id and to an unreachable node", () => {
  assert.ok(Math.abs(P.route(sq, { edge: 0, t: 0.5 }, "c").length - 150) < 1e-9);
  assert.equal(P.route(sq, { edge: 0, t: 0.5 }, "x"), null);
});
test("at walks a polyline with heading", () => {
  const a = P.at([[0, 0], [10, 0], [10, 10]], 15); assert.deepEqual(a.point, [10, 5]); assert.equal(a.segment, 1); assert.ok(Math.abs(a.angle - Math.PI / 2) < 1e-9);
});
test("inside", () => { assert.ok(P.inside([5, 5], [[0, 0], [10, 0], [10, 10], [0, 10]])); assert.ok(!P.inside([15, 5], [[0, 0], [10, 0], [10, 10], [0, 10]])); });
test("main scene: connected streets, every place has a door, area, labels, icon; only city pages (#/city/…) or «قيد البناء»", () => {
  global.window = {}; require("../../city/scenes/main.js"); const sc = global.window.MPCityScenes.main; delete global.window;
  assert.deepEqual(P.check(sc), []);
  const g = P.graph(sc.streets);
  for (const pl of sc.places) { assert.ok(pl.icon, pl.id); assert.ok(pl.href === undefined || /^#\/city\//.test(pl.href), pl.id + " links only inside the city"); assert.ok(P.route(g, sc.start, pl.door), pl.id + " reachable"); }
  // doors sit outside every building's tap area except their own (you never walk through a wall to reach one)
  for (const pl of sc.places) for (const o of sc.places) if (o !== pl) assert.ok(!P.inside(g.nodes[pl.door], o.area), `${pl.id} door inside ${o.id}`);
});
test("MJT hall scene: connected floor, every station reachable from the gate, opens an MJT screen or goes back", () => {
  global.window = {}; require("../../city/scenes/mjt.js"); const sc = global.window.MPCityScenes.mjt; delete global.window;
  assert.deepEqual(P.check(sc), []);
  const g = P.graph(sc.streets);
  assert.deepEqual(sc.places.map((p) => p.id).sort(), ["balance", "exit", "mining", "records", "stats", "wallet"]);
  for (const pl of sc.places) {
    assert.ok(pl.icon && pl.sign && pl.label.ar && pl.label.en, pl.id);
    assert.ok(pl.back || /^#\/city\/mjt\/(balance|history|send|earn|stats)$/.test(pl.href), pl.id + " opens its own city room");
    assert.ok(P.route(g, sc.start, pl.door), pl.id + " reachable");
  }
  for (const pl of sc.places) for (const o of sc.places) if (o !== pl) assert.ok(!P.inside(g.nodes[pl.door], o.area), `${pl.id} door inside ${o.id}`);
  assert.ok(sc.frames, "animated neon frames on");
});
