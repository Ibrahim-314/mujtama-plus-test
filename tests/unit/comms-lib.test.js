/* Track 6 — unit tests: RFC 6455 frame codec (lengths, masking, fragmentation, control frames, limits,
 * accept key), the client E2EE library from comms-core.js (MPComms.lib) on Node's WebCrypto:
 * ECDH P-256 + HKDF + AES-GCM envelope round-trip for several devices, tamper/misaddress failures,
 * encrypted attachments, and deterministic 60-digit safety numbers; bubble/time grouping helpers. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const { encodeFrame, FrameParser, OP, acceptKey } = require("../../server/lib/ws");
require("../../comms-core.js");
const M = globalThis.MPComms, L = M.lib;
const subtle = globalThis.crypto.subtle;

function parse(buf, o = {}) {
  const out = { msgs: [], ctrl: [], err: null };
  const p = new FrameParser({ requireMask: true, ...o, onMessage: (op, d) => out.msgs.push([op, d]), onControl: (op, d) => out.ctrl.push([op, d]), onError: (code, reason) => (out.err = { code, reason }) });
  if (Array.isArray(buf)) for (const b of buf) p.push(b); else p.push(buf);
  return out;
}

test("ws: Sec-WebSocket-Accept per RFC 6455 §1.3 example", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("ws: frame lengths 7/16/64-bit, masking round-trip, byte-by-byte streaming", () => {
  for (const n of [0, 1, 125, 126, 127, 65535, 65536, 70000]) {
    const data = crypto.randomBytes(n);
    const f = encodeFrame(OP.BIN, data, { mask: true });
    const headLen = 2 + (n < 126 ? 0 : n < 65536 ? 2 : 8) + 4;
    assert.equal(f.length, headLen + n, "frame size for " + n);
    assert.equal(f[1] & 0x7f, n < 126 ? n : n < 65536 ? 126 : 127);
    if (n > 8) assert.ok(!f.subarray(headLen, headLen + 8).equals(data.subarray(0, 8)), "payload is masked on the wire");
    const r = parse(f); assert.equal(r.err, null); assert.equal(r.msgs.length, 1); assert.ok(r.msgs[0][1].equals(data));
  }
  const unmasked = encodeFrame(OP.TEXT, "مرحبا"); assert.equal(unmasked[1] & 0x80, 0, "server frames unmasked");
  const r = parse(unmasked, { requireMask: false }); assert.equal(r.msgs[0][1].toString(), "مرحبا");
  // streaming one byte at a time across two frames
  const two = Buffer.concat([encodeFrame(OP.TEXT, "أ".repeat(300), { mask: true }), encodeFrame(OP.TEXT, "ب", { mask: true })]);
  const s = parse([...two].map(b => Buffer.from([b]))); assert.equal(s.msgs.length, 2); assert.equal(s.msgs[0][1].toString(), "أ".repeat(300));
});

test("ws: fragmentation with interleaved control frames; protocol errors", () => {
  const parts = [encodeFrame(OP.TEXT, "{\"t\":", { mask: true, fin: false }), encodeFrame(OP.PING, "p", { mask: true }), encodeFrame(OP.CONT, "\"x\"", { mask: true, fin: false }), encodeFrame(OP.CONT, "}", { mask: true })];
  const r = parse(Buffer.concat(parts)); assert.equal(r.err, null);
  assert.equal(r.msgs.length, 1); assert.equal(r.msgs[0][0], OP.TEXT); assert.equal(r.msgs[0][1].toString(), "{\"t\":\"x\"}");
  assert.deepEqual(r.ctrl.map(c => [c[0], c[1].toString()]), [[OP.PING, "p"]], "control frames may interleave a fragmented message");
  assert.equal(parse(encodeFrame(OP.TEXT, "x")).err.code, 1002, "unmasked client frame");
  assert.equal(parse(encodeFrame(OP.CONT, "x", { mask: true })).err.code, 1002, "continuation without a start");
  assert.equal(parse(encodeFrame(OP.PING, "x".repeat(126), { mask: true })).err.code, 1002, "control frame > 125 bytes");
  assert.equal(parse(encodeFrame(OP.PING, "x", { mask: true, fin: false })).err.code, 1002, "fragmented control frame");
  assert.equal(parse(Buffer.concat([encodeFrame(OP.TEXT, "a", { mask: true, fin: false }), encodeFrame(OP.TEXT, "b", { mask: true })])).err.code, 1002, "new message inside a fragmented one");
  assert.equal(parse(encodeFrame(0x3, "x", { mask: true })).err.code, 1002, "reserved opcode");
  const rsv = encodeFrame(OP.TEXT, "x", { mask: true }); rsv[0] |= 0x40; assert.equal(parse(rsv).err.code, 1002, "RSV1 without extension");
  assert.equal(parse(encodeFrame(OP.BIN, crypto.randomBytes(2000), { mask: true }), { maxPayload: 1024 }).err.code, 1009, "payload limit");
  const frag = [encodeFrame(OP.BIN, crypto.randomBytes(700), { mask: true, fin: false }), encodeFrame(OP.CONT, crypto.randomBytes(700), { mask: true })];
  assert.equal(parse(Buffer.concat(frag), { maxPayload: 1024 }).err.code, 1009, "limit applies to the reassembled message");
  // 64-bit length beyond the limit is refused from the header alone (no buffering)
  const huge = Buffer.alloc(14); huge[0] = 0x82; huge[1] = 0xff; huge.writeBigUInt64BE(1n << 40n, 2);
  assert.equal(parse(huge).err.code, 1009);
  // after an error the parser stays dead
  const p = new FrameParser({ requireMask: true, onMessage: () => assert.fail("no messages after error"), onControl() { }, onError() { } });
  p.push(encodeFrame(OP.TEXT, "x")); p.push(encodeFrame(OP.TEXT, "y", { mask: true }));
});

/* ---------- E2EE (comms-core.js) ---------- */
async function dev(id) {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const j = await subtle.exportKey("jwk", kp.publicKey);
  return { id, priv: kp.privateKey, pub: { kty: "EC", crv: "P-256", x: j.x, y: j.y } };
}

test("E2EE: ECDH P-256 + HKDF + AES-GCM envelope round-trip for every device (multi-device), base64url-safe", async () => {
  const a1 = await dev("dk_alice1"), a2 = await dev("dk_alice2"), b1 = await dev("dk_bob1"), c1 = await dev("dk_eve1");
  const payload = { t: "text", text: "رسالة سرية جداً 🔐 — اجتماع الساعة ٩", reply: null };
  const env = await L.seal(a1, [a1, a2, b1], "cv_test", payload);
  assert.equal(env.v, 1); assert.equal(env.from, "dk_alice1"); assert.deepEqual(Object.keys(env.keys).sort(), ["dk_alice1", "dk_alice2", "dk_bob1"]);
  assert.equal(L.unb64(env.iv).length, 12, "96-bit GCM nonce");
  assert.ok(!JSON.stringify(env).includes("سرية"), "no plaintext in the envelope");
  for (const v of [env.iv, env.ct, ...Object.values(env.keys).flatMap(k => k.split("."))]) assert.match(v, /^[A-Za-z0-9+/=_-]+$/, "server's B64 envelope check accepts it");
  assert.deepEqual(await L.unseal(b1, a1.pub, "cv_test", env), payload);
  assert.deepEqual(await L.unseal(a2, a1.pub, "cv_test", env), payload, "sender's other device");
  assert.deepEqual(await L.unseal(a1, a1.pub, "cv_test", env), payload, "sender's own device re-reads history");
  await assert.rejects(L.unseal(c1, a1.pub, "cv_test", env), (e) => e.code === "not-for-device");
  // the conversation id is authenticated data: replaying into another chat fails
  await assert.rejects(L.unseal(b1, a1.pub, "cv_other", env));
  // a stolen wrapped key cannot be re-addressed to another device
  await assert.rejects(L.unseal(c1, a1.pub, "cv_test", { ...env, keys: { dk_eve1: env.keys.dk_bob1 } }));
  // tampered ciphertext / wrong sender key
  const ct = L.unb64(env.ct); ct[3] ^= 1;
  await assert.rejects(L.unseal(b1, a1.pub, "cv_test", { ...env, ct: L.b64(ct) }));
  await assert.rejects(L.unseal(b1, c1.pub, "cv_test", env));
  // fresh message key and nonce every time
  const env2 = await L.seal(a1, [b1], "cv_test", payload); assert.notEqual(env2.ct, env.ct); assert.notEqual(env2.iv, env.iv);
  // interoperability: an independent WebCrypto implementation derives the same pair key
  const bits = await subtle.deriveBits({ name: "ECDH", public: await subtle.importKey("jwk", { ...a1.pub, ext: true }, { name: "ECDH", namedCurve: "P-256" }, true, []) }, b1.priv, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const pk = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("mujtama-e2ee-v1"), info: new TextEncoder().encode(["dk_alice1", "dk_bob1"].sort().join("|")) }, hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const [wiv, wk] = env.keys.dk_bob1.split(".");
  const K = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: L.unb64(wiv), additionalData: new TextEncoder().encode("cv_test|dk_bob1") }, pk, L.unb64(wk)));
  assert.equal(K.length, 32, "AES-256 message key");
  const msgKey = await subtle.importKey("raw", K, "AES-GCM", false, ["decrypt"]);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: L.unb64(env.iv), additionalData: new TextEncoder().encode("cv_test") }, msgKey, L.unb64(env.ct));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(pt)), payload);
});

test("E2EE: encrypted attachments round-trip (voice note), wrong key fails", async () => {
  const audio = new Uint8Array(crypto.randomBytes(5000)); audio.set([0x4f, 0x67, 0x67, 0x53]);
  const { data, fk, fiv } = await L.encryptFile(new Blob([audio], { type: "audio/ogg" }));
  assert.equal(data.type, "application/octet-stream"); const ct = new Uint8Array(await data.arrayBuffer());
  assert.equal(ct.length, audio.length + 16, "GCM tag appended"); assert.notDeepEqual(ct.subarray(0, 4), audio.subarray(0, 4), "magic bytes hidden from the server");
  const back = await L.decryptFile(ct.buffer, fk, fiv, "audio/ogg"); assert.equal(back.type, "audio/ogg");
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), audio);
  await assert.rejects(L.decryptFile(ct.buffer, L.b64(crypto.randomBytes(32)), fiv, "audio/ogg"));
});

test("safety numbers: 60 digits, deterministic, symmetric, order-independent over devices, change with any key", async () => {
  const a1 = await dev("dk_a1"), a2 = await dev("dk_a2"), b1 = await dev("dk_b1"), b2 = await dev("dk_b2");
  const s1 = await L.safetyFromKeys("u_alice", [a1, a2], "u_bob", [b1]);
  assert.match(s1, /^\d{60}$/, "the server's /^\\d{60}$/ verification check accepts it");
  assert.equal(await L.safetyFromKeys("u_alice", [a2, a1], "u_bob", [b1]), s1, "device order does not matter");
  assert.equal(await L.safetyFromKeys("u_bob", [b1], "u_alice", [a1, a2]), s1, "both sides see the same number");
  assert.notEqual(await L.safetyFromKeys("u_alice", [a1, a2], "u_bob", [b1, b2]), s1, "a new peer device changes it");
  assert.notEqual(await L.safetyFromKeys("u_alice", [a1], "u_bob", [b1]), s1);
  const ua = await L.userDigits("u_alice", [a1, a2]); assert.match(ua, /^\d{30}$/);
  assert.ok(s1 === ua + s1.slice(30) || s1 === s1.slice(0, 30) + ua, "lower user id's digits come first");
  assert.equal(L.formatSafety(s1).split(" ").length, 12); assert.ok(L.formatSafety(s1).split(" ").every(g => g.length === 5));
  // fixed vector for safetyDigits: 5 bytes big-endian mod 100000
  const bytes = new Uint8Array(30); bytes.set([0, 0, 0, 0x30, 0x39], 0); bytes.set([0xff, 0xff, 0xff, 0xff, 0xff], 5);
  assert.equal(L.safetyDigits(bytes).slice(0, 10), "12345" + String(0xffffffffff % 100000).padStart(5, "0"));
});

test("chat helpers: bubble clustering by sender and 5-minute gaps, day labels, disappearing timers", () => {
  const now = Date.parse("2026-10-16T12:00:00Z"), at = (min) => new Date(now - min * 60e3).toISOString();
  const msgs = [
    { id: 1, from: "a", at: at(60 * 30), kind: "text" },
    { id: 2, from: "a", at: at(10), kind: "text" }, { id: 3, from: "a", at: at(8), kind: "text" }, { id: 4, from: "a", at: at(1), kind: "text" },
    { id: 5, from: "b", at: at(0.5), kind: "text" }, { id: 6, from: "b", at: at(0.4), kind: "system" }, { id: 7, from: "b", at: at(0.3), kind: "text" }
  ];
  const days = M.group(msgs, { now });
  assert.equal(days.length, 2); assert.equal(days[1].day, "اليوم");
  assert.deepEqual(days[1].clusters.map(c => c.messages.map(m => m.id)), [[2, 3], [4], [5], [6], [7]]);
  assert.equal(days[1].clusters[3].system, true);
  assert.equal(L.dayLabel(at(60 * 24), now), "أمس");
  assert.equal(M.ttlLabel(3600), "ساعة"); assert.equal(M.ttlLabel(42), "إيقاف");
  assert.deepEqual(M.TTLS.map(t => t.value), [0, 300, 3600, 86400, 604800], "matches the server's allowed timers");
  assert.equal(M.remaining({ expiresAt: new Date(now + 5000).toISOString() }, now), 5000); assert.equal(M.remaining({}, now), null);
  assert.deepEqual(M.REACTIONS, ["❤️", "😂", "👍", "😮", "😢", "🙏", "🔥", "👏"], "same whitelist as the server");
});

/* ---------- regression: app bridge (window.DB / window.Remote are lexical globals, not window props) ---------- */
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const CORE_SRC = fs.readFileSync(path.join(__dirname, "..", "..", "comms-core.js"), "utf8");
function sandbox(prelude) {
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, Blob, URLSearchParams, setTimeout, clearTimeout, console });
  ctx.window = ctx;
  vm.runInContext(prelude, ctx, { filename: "app-prelude.js" }); // classic script: top-level let/const, like store.js / sync.js
  vm.runInContext(CORE_SRC, ctx, { filename: "comms-core.js" });
  return ctx;
}

test("bridge: comms-core sees the app's top-level `let DB` / `const Remote` (not window properties)", async () => {
  const ctx = sandbox(`let DB = { me: "u_me" }; const Remote = { on: true, calls: [], async api(m, p, b) { this.calls.push([m, p]); if (p === "/api/e2ee/devices" && m === "POST") return { device: { id: b.id } }; return {}; } };`);
  assert.equal(vm.runInContext("typeof window.DB", ctx), "undefined", "precondition: not a window property");
  const b = ctx.MPComms.lib._bridge;
  assert.equal(b.meId(), "u_me"); assert.equal(b.online(), true);
  const dev = await ctx.MPComms.e2ee.ready(); assert.match(dev.id, /^dk_[a-z0-9]{8,32}$/i, "device id passes the server's check");
  assert.deepEqual(vm.runInContext("Remote.calls", ctx)[0], ["POST", "/api/e2ee/devices"], "registration went through the lexical Remote");
  // sign-out → sign-in as another user is picked up live (no stale copy)
  vm.runInContext(`DB.me = null`, ctx); assert.equal(b.meId(), null);
  await assert.rejects(ctx.MPComms.e2ee.ready(), /not-signed-in/);
});

test("bridge: an explicit window.MPApp bridge wins; plain window properties still work; nothing → offline", async () => {
  const ctx = sandbox(`window.MPApp = { get DB() { return { me: "u_bridge" }; }, Remote: { on: false, api: async () => ({}) } };`);
  assert.equal(ctx.MPComms.lib._bridge.meId(), "u_bridge"); assert.equal(ctx.MPComms.lib._bridge.online(), false);
  const ctx2 = sandbox(`window.DB = { me: "u_prop" }; window.Remote = { on: true, api: async () => ({}) };`);
  assert.equal(ctx2.MPComms.lib._bridge.meId(), "u_prop");
  const ctx3 = sandbox(``);
  assert.equal(ctx3.MPComms.lib._bridge.meId(), null); assert.equal(ctx3.MPComms.lib._bridge.online(), false);
  assert.throws(() => ctx3.MPComms.lib._bridge.appRemote().api, TypeError);
});

/* ---------- regression: send(convId) must not treat an encrypted DM as plain because of a stale cache ---------- */
async function fakeServer() {
  const peer = await dev("dk_peerdevice1");
  const S = { e2ee: false, sent: [], devices: { u_peer: [{ id: peer.id, user: "u_peer", pub: peer.pub }] }, listFetched: 0, detailFetched: 0 };
  const Remote = {
    on: true,
    async api(m, p, b) {
      const err = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };
      if (m === "GET" && p === "/api/chat/conversations") { S.listFetched++; return { conversations: [{ id: "cv1", kind: "dm", e2ee: S.e2ee, members: ["u_me", "u_peer"] }] }; }
      if (m === "GET" && p === "/api/chat/conversations/cv1") { S.detailFetched++; return { conversation: { id: "cv1", kind: "dm", e2ee: S.e2ee, members: [{ user: "u_me" }, { user: "u_peer" }] }, people: [] }; }
      if (m === "POST" && p === "/api/e2ee/devices") { S.devices.u_me = [{ id: b.id, user: "u_me", pub: b.pub }]; return { device: { id: b.id, pub: b.pub } }; }
      if (m === "GET" && p.startsWith("/api/e2ee/keys?users=")) { const us = decodeURIComponent(p.split("=")[1]).split(","); return { keys: Object.fromEntries(us.map(u => [u, S.devices[u] || []])) }; }
      if (m === "POST" && p === "/api/chat/conversations/cv1/messages") {
        if (S.e2ee && !b.enc) err(400, "هذه المحادثة مشفرة: الرسالة يجب أن تكون مشفرة");
        if (S.sent.some(x => x.id === b.id && (x.enc || S.e2ee === !!x.enc))) return { message: { id: b.id, conv: "cv1", from: "u_me", ...S.sent.find(x => x.id === b.id) } };
        S.sent.push(b); return { message: { id: b.id, conv: "cv1", from: "u_me", kind: b.kind, text: b.enc ? "" : b.text, ...(b.enc ? { enc: b.enc } : {}) } };
      }
      err(404, "unexpected " + m + " " + p);
    }
  };
  return { S, Remote, peer };
}
function coreWith(Remote) {
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, Blob, URLSearchParams, setTimeout, clearTimeout, console });
  ctx.window = ctx; ctx.__Remote = Remote;
  vm.runInContext(`let DB = { me: "u_me" }; const Remote = __Remote;`, ctx);
  vm.runInContext(CORE_SRC, ctx, { filename: "comms-core.js" });
  return ctx.MPComms;
}

test("send(id): a conversation-list row (e2ee:false) never proves a chat is plaintext; encryption enabled meanwhile is honoured", async () => {
  const { S, Remote, peer } = await fakeServer(); const MP = coreWith(Remote);
  await MP.conversations();                     // cache seeded from the list: e2ee false
  S.e2ee = true;                                // the peer enables E2EE while our realtime transport is down (no "conv" event)
  const sent = await MP.send("cv1", { text: "سر بعد التفعيل" });
  const body = S.sent[S.sent.length - 1];
  assert.ok(body.enc, "sent as an envelope"); assert.equal(body.text, undefined, "no plaintext on the wire");
  assert.equal(sent.text, "سر بعد التفعيل", "returned message decrypted locally"); assert.equal(sent.encrypted, true);
  const back = await MP.lib.unseal(peer, S.devices.u_me[0].pub, "cv1", body.enc); assert.equal(back.text, "سر بعد التفعيل", "the peer can read it");
});

test("send(id): fresh detail said plaintext, peer enabled E2EE seconds later → 400 is retried encrypted with the same id", async () => {
  const { S, Remote } = await fakeServer(); const MP = coreWith(Remote);
  await MP.conversation("cv1");                 // fresh: e2ee false
  S.e2ee = true;
  const before = S.detailFetched;
  const m = await MP.send("cv1", { text: "إعادة المحاولة مشفرة" });
  assert.equal(m.encrypted, true); assert.ok(S.detailFetched > before, "refetched after the refusal");
  assert.equal(S.sent.length, 1); assert.ok(S.sent[0].enc);
  // from now on the cache knows it is encrypted (one-way), even if a stale list row says otherwise
  S.listFetched = 0; await MP.conversations();
  const fetched = S.detailFetched;
  const m2 = await MP.send("cv1", { text: "ثانية" }); assert.equal(m2.encrypted, true); assert.equal(S.detailFetched, fetched, "trusted cached e2ee:true, no extra round trip");
  // a caller-supplied stale object ({ id, e2ee:false }) does not downgrade either
  const m3 = await MP.send({ id: "cv1", e2ee: false, members: ["u_me", "u_peer"] }, { text: "ثالثة" }); assert.equal(m3.encrypted, true);
  assert.ok(S.sent.every(b => b.enc && b.text === undefined));
});

test("send(id): plaintext chats still send plaintext; other errors are not swallowed", async () => {
  const { S, Remote } = await fakeServer(); const MP = coreWith(Remote);
  const m = await MP.send("cv1", { text: "عادية" }); assert.equal(m.text, "عادية"); assert.equal(S.sent[0].text, "عادية"); assert.equal(S.sent[0].enc, undefined);
  await assert.rejects(MP.send("cv_missing", { text: "x" }), (e) => e.status === 404);
});
