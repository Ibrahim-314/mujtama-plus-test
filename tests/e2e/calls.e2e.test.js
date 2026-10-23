/* global MPCalls */
/* Track 6 — calls in real browsers (production build, Chromium with --use-fake-device-for-media-stream and
 * --use-fake-ui-for-media-stream): permission rules (stranger / block), a 1:1 video call placed from the
 * profile menu and answered on the incoming sheet, real WebRTC media both ways (decoded video frames, audible
 * fake-microphone tone measured with WebAudio), mute / camera reported to the peer, screen share,
 * hang-up + history, a declined voice call → missed-call notification, and an axe audit of the call screens. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S, A, B, C; const errors = [], ids = {};
const until = async (P, fn, arg, timeout = 15000) => { const end = Date.now() + timeout; let last; for (;;) { last = await P.evaluate(fn, arg).catch((e) => { last = e.message; return null; }); if (last) return last; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 160)); await P.waitForTimeout(150); } };
const call = (P, method, path, body) => P.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [method, path, body]);
async function user(handle, name) {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce", permissions: ["camera", "microphone"] }); const P = await ctx.newPage();
  P.on("pageerror", e => errors.push(handle + ": " + e.message));
  await onboard(P, S.base, handle, name);
  ids[handle] = (await call(P, "GET", "/api/me")).user.id;
  await P.evaluate(() => window.MPChunks?.load("calls").then(() => window.MPChunks.load("callsui")));
  await until(P, () => !!window.MPCalls && window.MPCalls.supports.webrtc);
  return P;
}
/** decoded remote video: a <video> showing the peer's stream with real frames */
/** wait until the previous call has fully ended on this side (its "ended" event can trail the peer's hang-up), then reset */
const settle = async (P) => { await until(P, () => !["outgoing", "incoming", "connecting", "active", "reconnecting"].includes(MPCalls.state)); await P.evaluate(() => MPCalls.reset()); };
const remoteVideo = (P, peer) => until(P, (pid) => { const s = MPCalls.stream(pid); if (!s) return null; const v = [...document.querySelectorAll("video")].find(x => x.srcObject === s); return v && v.videoWidth > 0 && v.readyState >= 2 ? { w: v.videoWidth, h: v.videoHeight } : null; }, peer);
/** audible remote audio: RMS of the peer's audio track through an AnalyserNode (fake mic = beeping tone) */
const remoteAudioLevel = (P, peer) => P.evaluate(async (pid) => {
  const s = MPCalls.stream(pid); const t = s && s.getAudioTracks()[0]; if (!t) return -1;
  const ac = new AudioContext(); const src = ac.createMediaStreamSource(new MediaStream([t])); const an = ac.createAnalyser(); an.fftSize = 2048; src.connect(an);
  const buf = new Float32Array(an.fftSize); let peak = 0;
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 100)); an.getFloatTimeDomainData(buf); peak = Math.max(peak, Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length)); }
  await ac.close(); return peak;
}, peer);

test.before(async () => {
  S = await startStack();
  A = await user("amal_cl", "أمل"); B = await user("badr_cl", "بدر"); C = await user("chadi_cl", "شادي");
  await call(B, "PUT", "/api/follows/" + ids.amal_cl); // B lets A reach the inbox → A may call B
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("permission rules: strangers and blocked users cannot ring; the engine surfaces the refusal", async () => {
  const r = await C.evaluate(async (to) => { try { await MPCalls.start({ to, kind: "voice" }); return "started"; } catch (e) { return e.status || e.message; } }, ids.badr_cl);
  assert.equal(r, 403, "C is not followed by B and has no accepted conversation");
  assert.notEqual(await C.evaluate(() => MPCalls.state), "outgoing", "no dangling outgoing call");
  await C.evaluate(() => MPCalls.reset());
  await call(B, "PUT", "/api/me/prefs", { blocked: [ids.amal_cl] });
  assert.equal((await call(A, "POST", "/api/calls", { to: ids.badr_cl })).status, 403, "blocked");
  await call(B, "PUT", "/api/me/prefs", { blocked: [] }); await call(B, "PUT", "/api/follows/" + ids.amal_cl);
  assert.equal(await B.evaluate(() => MPCalls.state), "idle", "the callee never saw a ring");
});

test("1:1 video call from the profile menu: incoming sheet, real two-way media, mute/camera state, screen share, hang-up", async () => {
  await A.goto(S.base + "/?nosw#/u/badr_cl"); await until(A, () => !!window.MPCalls);
  await A.waitForSelector("[data-call-menu]", { timeout: 15000 });
  await A.click("[data-call-menu]"); await A.click("#sheet [data-call=video]");
  await B.waitForSelector(".cl-in.on", { timeout: 15000 });
  assert.match(await B.textContent(".cl-in"), /أمل/);
  assert.equal(await A.evaluate(() => MPCalls.state), "outgoing");
  await B.click('.cl-in [data-a="accept"]');
  await until(A, () => MPCalls.state === "active"); await until(B, () => MPCalls.state === "active");
  await B.waitForSelector(".cl-full.on");
  // real media: decoded video frames and an audible tone in both directions
  const vb = await remoteVideo(B, ids.amal_cl), va = await remoteVideo(A, ids.badr_cl);
  assert.ok(vb.w > 0 && va.w > 0, `video frames decoded (${vb.w}×${vb.h}, ${va.w}×${va.h})`);
  assert.ok(await remoteAudioLevel(B, ids.amal_cl) > 0.001, "A's microphone is audible at B");
  assert.ok(await remoteAudioLevel(A, ids.badr_cl) > 0.001, "B's microphone is audible at A");
  const srv = await call(A, "GET", "/api/calls/active"); assert.equal(srv.active.call.status, "active"); assert.equal(srv.active.call.kind, "video");
  // mute from the UI → the server and the peer's engine see it
  await A.click('.cl-full [data-a="mute"]');
  await until(B, (a) => MPCalls.call?.participants?.find(p => p.id === a)?.mic === false, ids.amal_cl);
  assert.equal(await A.evaluate(() => MPCalls.local.getAudioTracks().every(t => !t.enabled)), true, "local audio track disabled");
  await A.click('.cl-full [data-a="mute"]');
  await until(B, (a) => MPCalls.call?.participants?.find(p => p.id === a)?.mic === true, ids.amal_cl);
  // camera off → peer state; back on → frames again
  await A.click('.cl-full [data-a="cam"]');
  await until(B, (a) => MPCalls.call?.participants?.find(p => p.id === a)?.camera === false, ids.amal_cl);
  await A.click('.cl-full [data-a="cam"]');
  await until(B, (a) => MPCalls.call?.participants?.find(p => p.id === a)?.camera === true, ids.amal_cl);
  // screen share (fake capture source) → replaceTrack, reported to the server and the peer
  const share = await A.evaluate(async () => { try { await MPCalls.startScreen(); return { ok: true, screen: MPCalls.media.screen, hint: MPCalls.screenTrack?.contentHint }; } catch (e) { return { ok: false, err: e.name + ": " + e.message }; } });
  assert.equal(share.ok, true, "getDisplayMedia with the fake capture UI: " + share.err);
  assert.equal(share.screen, true); assert.equal(share.hint, "detail");
  await until(B, (a) => MPCalls.call?.participants?.find(p => p.id === a)?.screen === true, ids.amal_cl);
  assert.ok((await remoteVideo(B, ids.amal_cl)).w > 0, "B decodes the shared screen");
  await A.evaluate(() => MPCalls.stopScreen());
  await until(B, (a) => MPCalls.call?.participants?.find(p => p.id === a)?.screen === false, ids.amal_cl);
  // hang up from the UI
  await A.click('.cl-full [data-a="end"]');
  await until(A, () => MPCalls.state === "ended" || MPCalls.state === "idle"); await until(B, () => MPCalls.state === "ended" || MPCalls.state === "idle");
  const h = await A.evaluate(() => MPCalls.history()); const last = h.calls[0];
  assert.equal(last.status, "ended"); assert.equal(last.endReason, "completed"); assert.equal(last.direction, "outgoing"); assert.equal(last.kind, "video");
  assert.equal(await A.evaluate(() => MPCalls.local), null, "camera and microphone released");
});

test("declined voice call → caller sees «declined»; unanswered call → missed-call notification for the callee", async () => {
  await settle(A); await settle(B);
  await A.evaluate((to) => MPCalls.start({ to, kind: "voice" }), ids.badr_cl);
  await B.waitForSelector(".cl-in.on", { timeout: 15000 });
  await B.click('.cl-in [data-a="decline"]');
  await until(A, () => MPCalls.state === "ended" && MPCalls.endReason === "declined");
  // missed: A calls, then cancels before B answers (callee side becomes missed)
  await settle(A); await settle(B);
  await A.evaluate((to) => MPCalls.start({ to, kind: "voice" }), ids.badr_cl);
  await B.waitForSelector(".cl-in.on", { timeout: 15000 });
  await A.evaluate(() => MPCalls.hangup());
  await B.waitForSelector(".cl-in.on", { state: "detached", timeout: 10000 }).catch(() => {});
  await until(B, () => MPCalls.state !== "incoming");
  const n = await until(B, async () => { const r = await fetch("/api/notifications?view=center&tab=messages", { headers: { "X-Requested-With": "mujtama" } }).then(r => r.json()); return r.groups.find(g => g.kind === "call_missed") || null; });
  assert.match(n.text, /أمل فاتتك مكالمة/);
  const hist = await B.evaluate(() => MPCalls.history()); assert.ok(hist.unseenMissed >= 1);
});

test("accessibility: incoming call sheet, call screen and call history have no serious/critical WCAG A/AA violations", async () => {
  const audit = async (P) => { await P.addScriptTag({ path: require.resolve("axe-core/axe.min.js") }); return (await P.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") })))).filter(v => ["serious", "critical"].includes(v.impact)); };
  const report = {};
  // independent of the previous test: clear any call it left ringing
  await A.evaluate(async () => { try { await MPCalls.hangup(); } catch { /* none */ } }); await B.evaluate(async () => { try { await MPCalls.decline(); } catch { /* none */ } });
  await settle(A); await settle(B);
  await A.evaluate((to) => MPCalls.start({ to, kind: "video" }), ids.badr_cl);
  await B.waitForSelector(".cl-in.on", { timeout: 15000 }); await B.waitForTimeout(600);
  report.incoming = await audit(B);
  await B.click('.cl-in [data-a="accept"]'); await until(B, () => MPCalls.state === "active"); await B.waitForSelector(".cl-full.on"); await B.waitForTimeout(800);
  report.active = await audit(B);
  await B.evaluate(() => MPCalls.hangup()); await until(A, () => MPCalls.state === "ended" || MPCalls.state === "idle");
  await A.goto(S.base + "/?nosw#/calls"); await A.waitForTimeout(1500);
  report.history = await audit(A);
  const bad = Object.entries(report).filter(([, v]) => v.length);
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
