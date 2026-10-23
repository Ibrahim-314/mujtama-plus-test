/* v2.70 — client QoE helper (qoe.js, window.MPQoE): startup = play request → first 'playing', initial buffering is not a
 * stall, re-buffer stalls counted with their duration, watched time excludes pauses/stalls, HLS rung read from el._mpHls,
 * batches flushed with sendBeacon at 10 events / on pagehide (≤ 20 per beacon), invalid tracks ignored. Fake clock + video. */
const test = require("node:test"), assert = require("node:assert");

class FakeVideo {
  constructor() { this.l = {}; this.paused = true; this.autoplay = false; }
  addEventListener(k, f) { (this.l[k] ||= new Set()).add(f); }
  removeEventListener(k, f) { this.l[k]?.delete(f); }
  fire(k) { for (const f of [...(this.l[k] || [])]) f({ type: k }); }
  listeners() { return Object.values(this.l).reduce((a, s) => a + s.size, 0); }
}
let T = 0; const beacons = []; const winL = {}, docL = {};
global.window = { addEventListener: (k, f) => { winL[k] = f; }, document: { visibilityState: "visible", addEventListener: (k, f) => { docL[k] = f; } }, performance: { now: () => T } };
Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } } }); // Node ≥ 21 has a read-only navigator getter
const Q = require("../../video/player/qoe.js");
Q._now = () => T;
const sent = async () => { const out = []; for (const b of beacons.splice(0)) { assert.equal(b.url, "/api/video/qoe"); out.push(JSON.parse(await b.blob.text())); } return out; };

test("startup, stalls, watched time and rung from a fake video element", async () => {
  T = 1000; const v = new FakeVideo(); v._mpHls = { currentLevel: 1 };
  const s = Q.track(v, "p_1", "clips"); assert.ok(s);
  v.fire("play"); T = 1200; v.fire("waiting"); // initial buffering → part of startup, not a stall
  T = 1450; v.fire("playing"); // startup 450
  v._mpHls.currentLevel = 3;
  T = 5450; v.fire("waiting"); // watched 4000, stall #1
  T = 6450; v.fire("playing"); // stall 1000
  T = 8450; v.fire("pause"); // watched +2000
  T = 20000; v.fire("play"); T = 20100; v.fire("playing"); // resume (startup unchanged)
  T = 21100; v.fire("waiting"); T = 21600; v.fire("waiting"); // one stall even if 'waiting' repeats
  T = 22100; v.fire("playing"); T = 23100;
  const snap = s.snapshot();
  assert.deepEqual(snap, { postId: "p_1", source: "clips", startupMs: 450, stalls: 2, stallMs: 2000, watchedMs: 8000, rung: 3 });
  v.fire("ended");
  assert.equal(v.listeners(), 0, "listeners removed on finish");
  assert.equal(Q._queue.length, 1); assert.deepEqual(Q._queue[0], snap);
  assert.equal(s.finish(), null, "finish is idempotent");
  Q.flush(); const b = await sent(); assert.equal(b.length, 1); assert.deepEqual(b[0].events, [snap]);
});

test("summarize: open playing/stall intervals counted up to now; never negative", () => {
  const s = { postId: "x", source: "post", startupMs: 12.4, stalls: 1, stallMs: 100, watchedMs: 900, playingSince: null, stallSince: 1000, rung: null };
  assert.deepEqual(Q.summarize(s, 1500), { postId: "x", source: "post", startupMs: 12, stalls: 1, stallMs: 600, watchedMs: 900, rung: null });
  assert.deepEqual(Q.summarize({ ...s, stallSince: null, playingSince: 1000 }, 1250).watchedMs, 1150);
  assert.equal(Q.summarize({ ...s, startupMs: -3 }, 1000).startupMs, 0);
});

test("rungOf: null without hls, currentLevel, then loadLevel fallback, capped at 15", () => {
  assert.equal(Q.rungOf({}), null);
  assert.equal(Q.rungOf({ _mpHls: { currentLevel: -1, loadLevel: 2 } }), 2);
  assert.equal(Q.rungOf({ _mpHls: { currentLevel: 4 } }), 4);
  assert.equal(Q.rungOf({ _mpHls: { currentLevel: -1, loadLevel: -1 } }), null);
  assert.equal(Q.rungOf({ _mpHls: { currentLevel: 40 } }), 15);
});

test("never-started playback reports nothing; autoplay counts from track(); re-tracking an element ends the old session", async () => {
  T = 0; const v = new FakeVideo(); Q.track(v, "p_none", "post"); v.fire("emptied"); assert.equal(Q._queue.length, 0);
  const a = new FakeVideo(); a.autoplay = true; T = 100; Q.track(a, "p_auto", "clips"); T = 400; a.fire("playing"); T = 900;
  Q.track(a, "p_next", "clips"); // element reused → previous session finished
  assert.equal(Q._queue.length, 1); assert.equal(Q._queue[0].postId, "p_auto"); assert.equal(Q._queue[0].startupMs, 300); assert.equal(Q._queue[0].watchedMs, 500);
  assert.equal(a.listeners(), 6, "only the new session listens");
  Q._queue.length = 0; Q.finishAll(); await sent();
});

test("invalid tracks are ignored", () => {
  assert.equal(Q.track(null, "p", "clips"), null);
  assert.equal(Q.track(new FakeVideo(), "", "clips"), null);
  assert.equal(Q.track(new FakeVideo(), "p", "story"), null);
});

test("batching: auto-flush at 10 queued playbacks; pagehide finishes live sessions and flushes; ≤ 20 per beacon", async () => {
  await sent();
  for (let i = 0; i < 10; i++) { const v = new FakeVideo(); T = i * 10; Q.track(v, "b" + i, "post"); v.fire("play"); T += 5; v.fire("playing"); T += 5; v.fire("ended"); }
  let b = await sent(); assert.equal(b.length, 1); assert.equal(b[0].events.length, 10); assert.equal(Q._queue.length, 0);
  const live = new FakeVideo(); Q.track(live, "live", "clips"); live.fire("play"); T += 50; live.fire("playing"); T += 1000;
  winL.pagehide(); b = await sent(); assert.equal(b.length, 1); assert.deepEqual(b[0].events.map(e => [e.postId, e.watchedMs]), [["live", 1000]]);
  for (let i = 0; i < 25; i++) Q._queue.push({ postId: "q" + i }); Q.flush(); b = await sent();
  assert.deepEqual(b.map(x => x.events.length), [20, 5]);
  const v2 = new FakeVideo(); Q.track(v2, "hid", "post"); v2.fire("play"); v2.fire("playing");
  global.window.document.visibilityState = "hidden"; docL.visibilitychange(); b = await sent();
  assert.equal(b[0].events[0].postId, "hid");
});

test("falls back to fetch keepalive with the CSRF header when sendBeacon refuses", async () => {
  const calls = []; const prev = global.navigator.sendBeacon;
  global.navigator.sendBeacon = () => false; global.fetch = async (u, o) => { calls.push([u, o]); return {}; };
  try { Q._queue.push({ postId: "f" }); Q.flush(); } finally { global.navigator.sendBeacon = prev; }
  assert.equal(calls.length, 1); assert.equal(calls[0][1].keepalive, true); assert.equal(calls[0][1].headers["X-Requested-With"], "mujtama");
});

/* v2.70 fix (QA qa270-media): the player stamps the play request / first 'playing' synchronously and the chunk may attach late */
test("late attach: startupMs measured from the player's play request, even when 'playing' already fired", async () => {
  Q._queue.length = 0; await sent();
  T = 1000; const v = new FakeVideo(); const st = { requestedAt: 1000 }; v.paused = false;
  T = 1380; st.playingAt = 1380; // 'playing' before the chunk loaded
  T = 1500; const s = Q.track(v, "late1", "clips", st);
  assert.equal(s.state.startupMs, 380, "not ~0");
  T = 3500; v.fire("pause");
  assert.deepEqual([s.snapshot().startupMs, s.snapshot().watchedMs], [380, 2120], "watched counted from the real first frame");
  v.fire("ended"); assert.equal(Q._queue.at(-1).startupMs, 380);
  // attached after play() but before 'playing'
  const w = new FakeVideo(); w.paused = false; const st2 = { requestedAt: 5000 };
  T = 5200; Q.track(w, "late2", "clips", st2); T = 5700; w.fire("playing"); T = 6000; w.fire("ended");
  assert.equal(Q._queue.at(-1).startupMs, 700);
  // attached before play (the normal early-load path): stamps written later are read live
  const e = new FakeVideo(); const st3 = {}; T = 8000; Q.track(e, "early", "post", st3);
  T = 9000; st3.requestedAt = 9000; e.fire("play"); T = 9250; e.fire("playing"); e.fire("ended");
  assert.equal(Q._queue.at(-1).startupMs, 250);
  // a never-played mount reports nothing; an MP4 fallback ('emptied') before the first frame keeps the session
  const n = new FakeVideo(); const st4 = {}; Q.track(n, "fallback", "post", st4); n.fire("emptied");
  T = 10000; st4.requestedAt = 10000; n.fire("play"); T = 10900; n.fire("playing"); n.fire("ended");
  assert.equal(Q._queue.at(-1).postId, "fallback"); assert.equal(Q._queue.at(-1).startupMs, 900);
  Q._queue.length = 0;
});

test("rung: read from the player box (MPPlayer keeps hls.js on the container) as well as the element", () => {
  const box = { _mpHls: { currentLevel: 2 } };
  assert.equal(Q.rungOf({ parentElement: box }), 2);
  assert.equal(Q.rungOf({ parentNode: { _mpHls: { currentLevel: -1, loadLevel: 1 } } }), 1);
  assert.equal(Q.rungOf({ _mpHls: { currentLevel: 5 }, parentElement: box }), 5, "element wins");
  assert.equal(Q.rungOf({ parentElement: {} }), null);
  T = 0; const v = new FakeVideo(); v.parentElement = box; const st = {};
  Q.track(v, "rung", "clips", st); st.requestedAt = 0; v.fire("play"); T = 100; v.fire("playing");
  box._mpHls = null; v.fire("ended"); // destroy() drops hls first: the rung seen while playing is kept
  assert.equal(Q._queue.at(-1).rung, 2); Q._queue.length = 0;
});
