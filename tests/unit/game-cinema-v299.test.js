/* Phase 2A — the game's cinematic sequencer (game/src/bjs/cinema.js): timing, easing, subtitles, skip (onComplete exactly
 * once), cancellation and disposal. The module has no imports, so it runs under node with a stand-in camera that has the
 * same surface as a Babylon FreeCamera (position {x,y,z}, setTarget, getTarget). */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path");
const URL_ = require("node:url").pathToFileURL(path.join(__dirname, "..", "..", "game", "src", "bjs", "cinema.js")).href;
const load = () => import(URL_);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
function cam(x = 0, y = 0, z = 0) {
  const c = { position: { x, y, z }, target: { x: 0, y: 0, z: -1 }, sets: 0 };
  c.setTarget = (v) => { c.target = { x: v.x, y: v.y, z: v.z }; c.sets++; };
  c.getTarget = () => c.target;
  return c;
}

test("easing curves hit 0 and 1 and stay monotonic", async () => {
  const { EASE } = await load();
  for (const [n, f] of Object.entries(EASE)) {
    assert.ok(near(f(0), 0), n + "(0)"); assert.ok(near(f(1), 1), n + "(1)");
    let last = -1; for (let i = 0; i <= 50; i++) { const v = f(i / 50); assert.ok(v >= last - 1e-9, n + " monotonic"); last = v; }
  }
  assert.ok(near(EASE.inOutCubic(0.5), 0.5));
});

test("time-based: the same position at the same time whatever the frame rate", async () => {
  const { Sequence } = await load();
  const mk = (c) => new Sequence({ camera: c, shots: [{ dur: 2, ease: "linear", from: { pos: [0, 0, 0], look: [0, 0, -1] }, to: { pos: [10, 0, 0], look: [0, 0, -1] } }] }).start();
  const a = cam(), b = cam(); const sa = mk(a), sb = mk(b);
  for (let i = 0; i < 30; i++) sa.update(1 / 30);    // 1 s at 30 fps
  for (let i = 0; i < 120; i++) sb.update(1 / 120);  // 1 s at 120 fps
  assert.ok(near(a.position.x, 5, 1e-6) && near(b.position.x, 5, 1e-6), `${a.position.x} ${b.position.x}`);
  assert.ok(near(sa.progress, 0.5, 1e-9));
});

test("shots run in order, a hold keeps the framing, a shot without `from` starts where the last one ended", async () => {
  const { Sequence } = await load();
  const c = cam(), seen = [], done = [];
  const s = new Sequence({ camera: c, onShot: (i) => seen.push(i), onComplete: (r) => done.push(r), shots: [
    { dur: 1, ease: "linear", from: { pos: [0, 0, 0], look: [0, 0, -5] }, to: { pos: [4, 0, 0], look: [0, 0, -5] } },
    { dur: 1, hold: true },
    { dur: 2, ease: "linear", to: { pos: [4, 8, 0], look: [0, 4, -5] } }
  ] }).start();
  assert.strictEqual(s.duration, 4);
  s.update(1.5); assert.deepStrictEqual(seen, [0, 1]); assert.ok(near(c.position.x, 4) && near(c.position.y, 0));
  s.update(1.5); assert.deepStrictEqual(seen, [0, 1, 2]); assert.ok(near(c.position.y, 4), String(c.position.y)); assert.ok(near(c.target.y, 2));
  s.update(5); assert.ok(near(c.position.y, 8)); assert.strictEqual(s.state, "done");
  assert.deepStrictEqual(done, [{ skipped: false }]);
  s.update(1); s.skip(); assert.strictEqual(done.length, 1, "nothing after the end");
});

test("a long frame never skips a shot's start", async () => {
  const { Sequence } = await load();
  const seen = [];
  const s = new Sequence({ onShot: (i) => seen.push(i), shots: [{ dur: 0.2, to: { pos: [1, 0, 0] } }, { dur: 0.2, to: { pos: [2, 0, 0] } }, { dur: 5, to: { pos: [3, 0, 0] } }] }).start();
  s.update(1); assert.deepStrictEqual(seen, [0, 1, 2]);
});

test("subtitles: Arabic and English, rtl/ltr, shown and cleared on time", async () => {
  const { Sequence } = await load();
  let lang = "ar"; const log = [];
  const subs = [{ at: 0.5, dur: 1, text: { ar: "مرحباً", en: "Hello" }, who: { ar: "الراوي", en: "Narrator" } }, { at: 2, dur: 1, text: "plain" }];
  const s = new Sequence({ lang: () => lang, onSubtitle: (l) => log.push(l), shots: [{ dur: 3, hold: true }], subtitles: subs }).start();
  s.update(0.4); assert.strictEqual(log.length, 0);
  s.update(0.2); assert.deepStrictEqual(log.at(-1), { text: "مرحباً", who: "الراوي", dir: "rtl" });
  s.update(1); assert.strictEqual(log.at(-1), null);
  lang = "en"; s.update(0.5); assert.deepStrictEqual(log.at(-1), { text: "plain", who: "", dir: "ltr" });
  const e = new Sequence({ lang: "en", onSubtitle: (l) => log.push(l), shots: [{ dur: 1, hold: true }], subtitles: subs.slice(0, 1) }).start();
  e.update(0.6); assert.deepStrictEqual(log.at(-1), { text: "Hello", who: "Narrator", dir: "ltr" });
});

test("skip: final framing, subtitles cleared, onComplete exactly once with skipped:true", async () => {
  const { Sequence } = await load();
  const c = cam(); let n = 0, arg = null; const log = [];
  const s = new Sequence({ camera: c, onSubtitle: (l) => log.push(l), onComplete: (r) => { n++; arg = r; },
    shots: [{ dur: 2, from: { pos: [0, 0, 0], look: [0, 0, -1] }, to: { pos: [1, 2, 3], look: [0, 1, -9] } }, { dur: 2, to: { pos: [5, 5, 5] } }],
    subtitles: [{ at: 0, dur: 10, text: "x" }] }).start();
  s.update(0.5); assert.strictEqual(log.at(-1).text, "x");
  s.skip(); s.skip(); s.update(1); s.skip();
  assert.strictEqual(n, 1); assert.deepStrictEqual(arg, { skipped: true });
  assert.deepStrictEqual(c.position, { x: 5, y: 5, z: 5 }); assert.deepStrictEqual(c.target, { x: 0, y: 1, z: -9 });
  assert.strictEqual(log.at(-1), null); assert.strictEqual(s.progress, 1);
});

test("start twice does not restart; skip before start still completes once", async () => {
  const { Sequence } = await load();
  let n = 0; const s = new Sequence({ onComplete: () => n++, shots: [{ dur: 2, to: { pos: [1, 0, 0] } }] });
  s.skip(); s.start(); s.skip(); assert.strictEqual(n, 1);
  const r = new Sequence({ shots: [{ dur: 2, ease: "linear", from: { pos: [0, 0, 0] }, to: { pos: [2, 0, 0] } }] }).start();
  r.update(1); r.start(); assert.ok(near(r.pos.x, 1), "no restart");
});

test("an onComplete that throws or re-enters is still called once and does not break the caller", async () => {
  const { Sequence } = await load();
  let n = 0; const orig = console.error; console.error = () => { };
  try {
    const s = new Sequence({ shots: [{ dur: 1, hold: true }], onComplete: () => { n++; s.skip(); throw new Error("boom"); } }).start();
    s.update(2); s.skip(); assert.strictEqual(n, 1);
  } finally { console.error = orig; }
});

test("cancel: no onComplete, subtitle cleared, camera left alone; dispose drops references", async () => {
  const { Sequence } = await load();
  const c = cam(); let n = 0; const log = [];
  const s = new Sequence({ camera: c, onComplete: () => n++, onSubtitle: (l) => log.push(l),
    shots: [{ dur: 2, ease: "linear", from: { pos: [0, 0, 0] }, to: { pos: [2, 0, 0] } }], subtitles: [{ at: 0, dur: 2, text: "a" }] }).start();
  s.update(1); const x = c.position.x; s.cancel();
  s.update(5); s.skip(); s.start();
  assert.strictEqual(n, 0); assert.strictEqual(log.at(-1), null); assert.strictEqual(c.position.x, x); assert.strictEqual(s.state, "cancelled");
  const d = new Sequence({ camera: cam(), onComplete: () => n++, shots: [{ dur: 1, hold: true }] }).start();
  d.dispose(); d.update(5); d.skip();
  assert.strictEqual(n, 0); assert.strictEqual(d.camera, null);
});

test("without a camera the sequencer only reports frames; bad dt values are ignored", async () => {
  const { Sequence } = await load();
  const frames = [];
  const s = new Sequence({ onFrame: (p) => frames.push(p.x), shots: [{ dur: 1, ease: "linear", from: { pos: [0, 0, 0] }, to: { pos: [1, 0, 0] } }] }).start();
  for (const bad of [NaN, -1, 0, undefined, Infinity]) s.update(bad);
  assert.strictEqual(s.time, 0);
  s.update(0.25); assert.ok(near(frames.at(-1), 0.25));
  const empty = new Sequence({}); let n = 0; empty.on.complete = () => n++; empty.start(); assert.strictEqual(n, 1);
});

test("isolation: no three.js, no Babylon engine, no DOM, no globals", () => {
  const src = require("node:fs").readFileSync(path.join(__dirname, "..", "..", "game", "src", "bjs", "cinema.js"), "utf8");
  assert.ok(!/^\s*import\b/m.test(src), "no imports");
  assert.ok(!/\b(three|document|window|requestAnimationFrame|setTimeout|new Engine)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
});
