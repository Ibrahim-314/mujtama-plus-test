/* Track 7 — Phase 32 unit tests: relationship-graph primitives (components, label propagation, density,
 * reciprocity, conductance, co-occurrence, suspicious clusters) and the integrity heuristics (Arabic text
 * normalisation, SimHash near-duplicates, timing bursts, E.164, fake-follower score, Pi KYC parsing). */
const test = require("node:test"),
  assert = require("node:assert");
const G = require("../../server/lib/graph");
const I = require("../../server/services/integrity");

const clique = (g, ids, kind = "follow") => {
  for (const a of ids) for (const b of ids) if (a < b) g.addEdge(a, b, 1, kind);
};

test("WGraph sums weights per kind and lists each undirected edge once", () => {
  const g = new G.WGraph().addEdge("a", "b", 1, "follow").addEdge("b", "a", 2, "content").addEdge("a", "a", 5);
  assert.equal(g.weight("a", "b"), 3);
  assert.equal(g.weight("b", "a"), 3);
  assert.equal(g.edges().length, 1);
  assert.deepEqual(g.edges()[0][3], { follow: 1, content: 2 });
  assert.equal(g.degree("a"), 3);
  assert.deepEqual(g.nodes(), ["a", "b"], "self-loops ignored");
});

test("components honour the weight threshold and drop singletons", () => {
  const g = new G.WGraph().addEdge("a", "b", 3).addEdge("b", "c", 1).addEdge("x", "y", 2).addNode("lonely");
  assert.deepEqual(G.components(g, 2), [
    ["a", "b"],
    ["x", "y"]
  ]);
  assert.deepEqual(G.components(g, 0)[0], ["a", "b", "c"]);
});

test("label propagation separates two cliques joined by a single bridge, deterministically", () => {
  const g = new G.WGraph();
  clique(g, ["a1", "a2", "a3", "a4"]);
  clique(g, ["b1", "b2", "b3", "b4"]);
  g.addEdge("a4", "b1", 1);
  const c1 = G.labelPropagation(g),
    c2 = G.labelPropagation(g);
  assert.deepEqual(c1, c2);
  assert.equal(c1.length, 2);
  assert.deepEqual(
    c1.map(c => c.length),
    [4, 4]
  );
  assert.ok(c1.some(c => c.join() === "a1,a2,a3,a4"));
});

test("density, reciprocity and conductance", () => {
  const nodes = ["a", "b", "c"];
  const full = [
    ["a", "b"],
    ["b", "a"],
    ["a", "c"],
    ["c", "a"],
    ["b", "c"],
    ["c", "b"]
  ];
  assert.equal(G.density(nodes, full), 1);
  assert.equal(G.reciprocity(nodes, full), 1);
  assert.equal(
    G.density(nodes, [
      ["a", "b"],
      ["a", "b"],
      ["a", "a"]
    ]),
    1 / 6,
    "duplicates and self-loops ignored"
  );
  assert.equal(
    G.reciprocity(nodes, [
      ["a", "b"],
      ["b", "c"]
    ]),
    0
  );
  assert.equal(G.density(["a"], full), 0);
  const g = new G.WGraph();
  clique(g, ["a", "b", "c"]);
  g.addEdge("c", "z", 1);
  assert.ok(Math.abs(G.conductance(g, ["a", "b", "c"]) - 1) < 1e-9, "cut 1 / min(vol S=7, vol rest=1)");
  const g2 = new G.WGraph();
  clique(g2, ["a", "b", "c"]);
  clique(g2, ["x", "y", "z"]);
  g2.addEdge("c", "x", 1);
  assert.ok(G.conductance(g2, ["a", "b", "c"]) < 0.2);
});

test("co-occurrence counts pairs across groups", () => {
  const m = G.coOccurrence([
    ["b", "a", "c"],
    ["a", "b"],
    ["a", "a", "d"]
  ]);
  assert.equal(m.get("a|b"), 2);
  assert.equal(m.get("a|c"), 1);
  assert.equal(m.get("a|d"), 1);
  assert.equal(m.has("b|a"), false);
});

test("suspiciousClusters flags a closed mutual-follow ring and ignores a sparse community", () => {
  const ring = ["r1", "r2", "r3", "r4", "r5"],
    loose = ["l1", "l2", "l3", "l4", "l5", "l6"];
  const g = new G.WGraph(),
    directed = [];
  for (const a of ring) for (const b of ring) if (a !== b) directed.push([a, b]);
  for (let i = 0; i < loose.length - 1; i++) directed.push([loose[i], loose[i + 1]]);
  directed.push(["l1", "r1"]);
  for (const [s, d] of directed) g.addEdge(s, d, 1, "follow");
  const out = G.suspiciousClusters(g, directed, { minSize: 4 });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].members, ring);
  assert.equal(out[0].density, 1);
  assert.equal(out[0].reciprocity, 1);
  assert.ok(out[0].score >= 0.9, String(out[0].score));
});

test("Arabic normalisation strips diacritics, links, mentions, digits and elongation", () => {
  assert.equal(I.normText("أَهْلاً   بِكُمْ!!! https://x.co @ali #تقنية ١٢٣ رااااائع"), "اهلا بكم رائع");
  assert.equal(I.normText("مدرسة"), I.normText("مدرسه"));
});

test("SimHash: light edits stay within 3 bits, different texts do not; near-duplicate groups need distinct actors", () => {
  const a = "اربحوا معنا الآن انضموا إلى قناتنا الرائعة للحصول على أفضل العروض اليومية";
  const b = "اربحوا معنا الان، انضموا الى قناتنا الرائعة للحصول على افضل العروض اليومية!! 🔥";
  const c = "مساء الخير جميعاً، اليوم جربت وصفة جديدة للقهوة العربية بالهيل وكانت رائعة";
  assert.match(I.simhash(a), /^[0-9a-f]{16}$/);
  assert.ok(I.hamming(I.simhash(a), I.simhash(b)) <= 3);
  assert.ok(I.hamming(I.simhash(a), I.simhash(c)) > 10);
  assert.equal(I.simhash("!!! 123"), null);
  assert.equal(I.hamming(null, "00"), 64);
  const items = [
    { id: 1, actor: "u1", hash: I.simhash(a) },
    { id: 2, actor: "u2", hash: I.simhash(b) },
    { id: 3, actor: "u3", hash: I.simhash(a + " ") },
    { id: 4, actor: "u4", hash: I.simhash(c) }
  ];
  const groups = I.nearDuplicateGroups(items);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(x => x.id).sort(), [1, 2, 3]);
  assert.equal(I.nearDuplicateGroups(items.map(x => ({ ...x, actor: "same" }))).length, 0, "one account repeating itself is not a network");
});

test("bursts: distinct actors on one key within the window, non-overlapping", () => {
  const ev = (key, actor, s) => ({ key, actor, at: s * 1000 });
  const events = [
    ev("p1", "a", 0),
    ev("p1", "b", 10),
    ev("p1", "c", 20),
    ev("p1", "d", 30),
    ev("p1", "a", 31),
    ev("p1", "e", 500),
    ev("p2", "a", 0),
    ev("p2", "a", 1),
    ev("p2", "b", 2),
    ev("p2", "c", 3)
  ];
  const out = I.bursts(events, { windowMs: 120e3, minActors: 4 });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].actors, ["a", "b", "c", "d"]);
  assert.equal(out[0].key, "p1");
  assert.equal(I.bursts(events, { windowMs: 1000e3, minActors: 5 })[0].actors.length, 5);
});

test("E.164 normalisation with Saudi defaults and Arabic-Indic digits", () => {
  assert.equal(I.e164("0551234567"), "+966551234567");
  assert.equal(I.e164("٠٥٥ ١٢٣ ٤٥٦٧"), "+966551234567");
  assert.equal(I.e164("00966551234567"), "+966551234567");
  assert.equal(I.e164("966551234567"), "+966551234567");
  assert.equal(I.e164("551234567"), "+966551234567");
  assert.equal(I.e164("+1 (415) 555-0100"), "+14155550100");
  assert.equal(I.e164("0123", "20"), null);
  assert.equal(I.e164(12345), null);
});

test("fake-follower score: inactive limited newcomers score high, trust signals pull it down", () => {
  const base = { ageDays: 1, posts: 0, comments: 0, followers: 0, following: 10, hasAvatar: false, hasBio: false };
  assert.equal(I.fakeFollowerScore(base), 0.6, "a quiet newcomer alone stays below the 0.7 default");
  assert.equal(I.fakeFollowerScore({ ...base, following: 150 }), 0.85, "follow-spam ratio");
  assert.equal(I.fakeFollowerScore({ ...base, limited: true }), 0.9);
  assert.equal(I.fakeFollowerScore({ ...base, suspended: true }), 1);
  assert.equal(I.fakeFollowerScore({ ...base, following: 150, phoneVerified: true }), 0.45);
  assert.equal(I.fakeFollowerScore({ ...base, flagged: true, limited: true, verified: true }), 0);
  assert.equal(I.fakeFollowerScore({ ageDays: 400, posts: 30, comments: 10, followers: 50, following: 80, hasAvatar: true, hasBio: true }), 0);
});

test("Pi KYC parsing tolerates several response shapes", () => {
  assert.equal(I.piKycStatus({ uid: "x", kyc_verified: true }), "verified");
  assert.equal(I.piKycStatus({ uid: "x", kyc: { status: "approved" } }), "verified");
  assert.equal(I.piKycStatus({ uid: "x", credentials: { scopes: ["username"] } }), "linked");
  assert.equal(I.piKycStatus(null), null);
});
