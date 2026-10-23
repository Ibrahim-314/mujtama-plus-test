/* Track 6 — unit tests: TURN REST (coturn use-auth-secret) HMAC credentials, the network-adaptive quality
 * policy of calls-core.js (classify, hysteresis, encoder budgets across the mesh, getStats sampling),
 * the client call state machine and mesh offer rule, and the server-side lifecycle state machine. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const C = require("../../calls-core.js");
const S = require("../../server/services/calls");

test("TURN REST credentials: username '<unix expiry>:<user>', credential = base64(HMAC-SHA1(secret, username))", () => {
  const at = 1760572800000; // 2025-10-16T00:00:00Z
  const c = S.turnCredentials({ secret: "north-star", userId: "u_abc", ttl: 86400, at });
  assert.equal(c.username, "1760659200:u_abc");
  // independently computed reference value (RFC 2104 HMAC-SHA1, base64)
  assert.equal(c.credential, crypto.createHmac("sha1", Buffer.from("north-star")).update(Buffer.from("1760659200:u_abc")).digest("base64"));
  assert.match(c.credential, /^[A-Za-z0-9+/]{27}=$/, "20-byte digest → 28 base64 chars");
  assert.equal(c.ttl, 86400); assert.equal(c.expiresAt, "2025-10-17T00:00:00.000Z");
  assert.notEqual(S.turnCredentials({ secret: "other", userId: "u_abc", at }).credential, c.credential);
  assert.notEqual(S.turnCredentials({ secret: "north-star", userId: "u_abd", at }).credential, c.credential, "bound to the user");
  const ice = S.iceConfig("u_abc", { env: { TURN_URLS: "turn:t.example:3478", TURN_TTL: "3600" }, getSecret: () => "north-star", at });
  assert.equal(ice.iceServers[1].username, "1760576400:u_abc"); assert.equal(ice.expiresAt, "2025-10-16T01:00:00.000Z");
  const legacy = S.iceConfig("u", { env: { TURN_URL: "turn:legacy:3478", TURN_USER: "x" }, getSecret: (n) => n === "TURN_PASSWORD" ? "pw" : null });
  assert.deepEqual(legacy.iceServers[1], { urls: ["turn:legacy:3478"], username: "x", credential: "pw" }, "static TURN fallback");
  assert.equal(S.iceConfig("u", { env: { CALL_FORCE_RELAY: "1" }, getSecret: () => null }).iceTransportPolicy, "all", "relay only forced when a TURN server exists");
});

test("adaptive quality: classify thresholds (rtt, loss, available bitrate, limitation)", () => {
  assert.equal(C.classify({ rtt: 0.05, loss: 0, kbps: 3000 }), "high");
  assert.equal(C.classify({ rtt: 0.3 }), "medium"); assert.equal(C.classify({ loss: 0.03 }), "medium"); assert.equal(C.classify({ kbps: 800 }), "medium"); assert.equal(C.classify({ limited: "cpu" }), "medium");
  assert.equal(C.classify({ rtt: 0.5 }), "low"); assert.equal(C.classify({ loss: 0.1 }), "low"); assert.equal(C.classify({ kbps: 300 }), "low");
  assert.equal(C.classify({ rtt: 1.2 }), "audio"); assert.equal(C.classify({ loss: 0.2 }), "audio"); assert.equal(C.classify({ kbps: 100 }), "audio");
  assert.equal(C.classify({}), "high", "no data → optimistic");
  assert.equal(C.worst(["high", "low", null, "medium"]), "low"); assert.equal(C.worst([]), "high");
});

test("adaptive quality: hysteresis — degrade immediately, recover one step after 3 good samples", () => {
  let st = { level: "high", good: 0 };
  st = C.adapt(st, { loss: 0.2 }); assert.deepEqual(st, { level: "audio", good: 0, changed: true }, "straight down to audio");
  const good = { rtt: 0.05, loss: 0, kbps: 5000 };
  st = C.adapt(st, good); assert.equal(st.level, "audio"); assert.equal(st.good, 1);
  st = C.adapt(st, good); assert.equal(st.level, "audio");
  st = C.adapt(st, good); assert.equal(st.level, "low"); assert.equal(st.changed, true, "one step up after UP_AFTER good samples");
  for (let i = 0; i < 3; i++) st = C.adapt(st, good); assert.equal(st.level, "medium");
  st = C.adapt(st, good); st = C.adapt(st, { loss: 0.04 }); assert.equal(st.level, "medium"); assert.equal(st.good, 0, "a mediocre sample resets the recovery count");
  for (let i = 0; i < 3; i++) st = C.adapt(st, good); assert.equal(st.level, "high");
  assert.equal(C.UP_AFTER, 3);
});

test("encoder budgets: per-level bitrate/scale/fps, mesh uplink sharing, 4+ peers capped, audio-only pauses video, screen share keeps detail", () => {
  assert.deepEqual(C.encodingFor("high"), { active: true, maxBitrate: 1500e3, scaleResolutionDownBy: 1, maxFramerate: 30 });
  assert.deepEqual(C.encodingFor("low"), { active: true, maxBitrate: 200e3, scaleResolutionDownBy: 4, maxFramerate: 15 });
  assert.equal(C.encodingFor("high", { peers: 2 }).maxBitrate, 1125e3, "two connections share 1.5× budget");
  const four = C.encodingFor("high", { peers: 4 }); assert.equal(four.scaleResolutionDownBy, 2, "no 720p to a 4+ mesh"); assert.equal(four.maxBitrate, Math.round(600e3 * 1.5 / 4));
  const seven = C.encodingFor("low", { peers: 7 }); assert.equal(seven.maxBitrate, 100e3, "floor of 100 kbps per connection");
  assert.equal(C.encodingFor("audio").active, false);
  const scr = C.encodingFor("audio", { screen: true }); assert.equal(scr.active, true, "screen share stays on at audio level"); assert.equal(scr.scaleResolutionDownBy, 2);
  assert.equal(C.encodingFor("high", { screen: true }).maxBitrate, 2500e3); assert.equal(C.encodingFor("high", { screen: true, peers: 8 }).maxBitrate, Math.round(2500e3 * 1.5 / 8));
  assert.equal(C.audioBitrate("high"), 32000); assert.equal(C.audioBitrate("audio"), 16000);
  // budgets never increase as the mesh grows
  for (const lv of ["high", "medium", "low"]) for (let n = 1; n < 8; n++) assert.ok(C.encodingFor(lv, { peers: n + 1 }).maxBitrate <= C.encodingFor(lv, { peers: n }).maxBitrate, `${lv} ${n}→${n + 1}`);
});

test("getStats sampling: selected pair RTT and bitrate, remote loss, inbound loss deltas, send rate, limitation reason", () => {
  const s1 = C.sample([
    { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.12, availableOutgoingBitrate: 850000 },
    { type: "candidate-pair", nominated: false, state: "failed", currentRoundTripTime: 9 },
    { type: "remote-inbound-rtp", fractionLost: 0.01, roundTripTime: 0.2 },
    { type: "outbound-rtp", kind: "video", bytesSent: 100000, timestamp: 1000, qualityLimitationReason: "bandwidth" },
    { type: "inbound-rtp", kind: "audio", packetsLost: 10, packetsReceived: 990, audioLevel: 0.4 }
  ]);
  assert.equal(s1.rtt, 0.12, "selected pair's RTT"); assert.equal(s1.kbps, 850); assert.equal(s1.limited, "bandwidth"); assert.equal(s1.audioLevel, 0.4);
  assert.equal(s1.loss, 0.01, "max(remote fractionLost, inbound loss)"); assert.equal(s1.sendKbps, null, "no rate without a previous sample");
  const s2 = C.sample([
    { type: "candidate-pair", selected: true, state: "succeeded", currentRoundTripTime: 0.6 },
    { type: "outbound-rtp", kind: "video", bytesSent: 225000, timestamp: 3000, qualityLimitationReason: "none" },
    { type: "inbound-rtp", kind: "video", packetsLost: 40, packetsReceived: 1090 }
  ], s1.counters);
  assert.equal(s2.loss, 0.231, "30 lost vs 100 received since the last sample → 30/130"); assert.equal(s2.sendKbps, 500, "125 kB in 2 s"); assert.equal(s2.limited, null);
  assert.equal(C.classify(s2), "audio");
  const none = C.sample([]); assert.deepEqual([none.rtt, none.kbps, none.loss], [null, null, 0]);
});

test("client state machine and mesh offer rule", () => {
  const ok = [["idle", "outgoing"], ["idle", "incoming"], ["outgoing", "connecting"], ["incoming", "connecting"], ["connecting", "active"], ["active", "reconnecting"], ["reconnecting", "active"], ["active", "ended"], ["ended", "idle"], ["incoming", "ended"]];
  for (const [a, b] of ok) assert.ok(C.canTransition(a, b), `${a} → ${b}`);
  for (const [a, b] of [["idle", "active"], ["ended", "active"], ["outgoing", "active"], ["active", "incoming"], ["reconnecting", "outgoing"]]) assert.ok(!C.canTransition(a, b), `${a} ↛ ${b}`);
  assert.equal(C.MAX_PARTICIPANTS, 8); assert.equal(S.MAX_PARTICIPANTS, C.MAX_PARTICIPANTS, "client and server agree on the mesh cap");
  const a = { id: "u_a", joinedAt: "2026-10-16T10:00:00Z" }, b = { id: "u_b", joinedAt: "2026-10-16T10:00:05Z" };
  assert.equal(C.shouldOffer(b, a), true, "the later joiner offers"); assert.equal(C.shouldOffer(a, b), false);
  const t1 = { id: "u_1", joinedAt: "x" }, t2 = { id: "u_2", joinedAt: "x" };
  assert.ok(C.shouldOffer(t1, t2) !== C.shouldOffer(t2, t1), "exactly one side offers on a tie");
  // in an 8-person mesh every pair has exactly one offerer
  const peers = Array.from({ length: 8 }, (_, i) => ({ id: "u" + i, joinedAt: "2026-10-16T10:00:0" + (i % 3) + "Z" }));
  for (const x of peers) for (const y of peers) if (x !== y) assert.ok(C.shouldOffer(x, y) !== C.shouldOffer(y, x));
});

test("server lifecycle state machine (participants + call)", () => {
  const F = S.PARTICIPANT_FLOW;
  assert.ok(S.canMove(F, "ringing", "busy")); assert.ok(S.canMove(F, "declined", "joined"), "group rejoin"); assert.ok(!S.canMove(F, "joined", "declined"));
  assert.ok(S.canMove(S.CALL_FLOW, "ringing", "active")); assert.ok(!S.canMove(S.CALL_FLOW, "active", "ringing")); assert.deepEqual(S.CALL_FLOW.ended, []);
  assert.deepEqual(S.decide("ended", []), { status: "ended", reason: null });
});
