/* Phase 2B — the prologue «الإشارة»: the shot list, the timed events and the words (pure data modules, run under node).
 * The scene itself (WebGL) is covered by the game's e2e suite (tests/e2e/game-v288.e2e.test.js: creator → prologue → skip → room). */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path"), fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const G = path.join(__dirname, "..", "..", "game", "src");
const shotsMod = () => import(pathToFileURL(path.join(G, "scenes", "prologue-shots.js")).href);
const storyMod = () => import(pathToFileURL(path.join(G, "story", "prologue.js")).href);
const cinemaMod = () => import(pathToFileURL(path.join(G, "bjs", "cinema.js")).href);

test("duration is 60–90 s and every shot names a known set", async () => {
  const { SHOTS, SET_ORIGIN, DURATION } = await shotsMod();
  assert.ok(DURATION >= 60 && DURATION <= 90, "duration " + DURATION);
  for (const s of SHOTS) { assert.ok(SET_ORIGIN[s.set], s.set); assert.ok(s.dur > 0); }
  assert.strictEqual(SHOTS[0].set, "village"); assert.strictEqual(SHOTS.at(-1).set, "cabin");
  assert.deepStrictEqual([...new Set(SHOTS.map((s) => s.set))], ["village", "home", "train", "city", "cabin"], "the story order");
});

test("events are in order, inside the sequence, in the right sets", async () => {
  const { EVENTS, DURATION, SHOTS, shotStarts } = await shotsMod();
  const st = shotStarts(), setAt = (t) => { let k = 0; for (let i = 0; i < st.length; i++) if (t >= st[i]) k = i; return SHOTS[k].set; };
  let last = -1; for (const e of EVENTS) { assert.ok(e.at > last && e.at < DURATION, e.ev); last = e.at; }
  const where = Object.fromEntries(EVENTS.map((e) => [e.ev, setAt(e.at)]));
  assert.strictEqual(where["device-on"], "home"); assert.strictEqual(where.message, "home");
  assert.strictEqual(where["lights-fail"], "cabin"); assert.strictEqual(where.signal, "cabin"); assert.strictEqual(where.title, "cabin");
});

test("Yousuf's message is the exact Arabic text, word for word, and shown while the home set is on screen", async () => {
  const { PROLOGUE, YOUSUF_MESSAGE } = await storyMod();
  const { SHOTS, shotStarts } = await shotsMod();
  assert.strictEqual(YOUSUF_MESSAGE, "إذا وصلتك هذي، فأنا ما قدرت أرجع. الطابق الأربعين… المفتاح عندك من زمان. لا تثق بالشاشات…");
  const ys = PROLOGUE.subtitles.filter((l) => l.who.en.startsWith("Yousuf"));
  assert.strictEqual(ys.map((l) => l.text.ar).join(" "), YOUSUF_MESSAGE);
  const st = shotStarts(), setAt = (t) => { let k = 0; for (let i = 0; i < st.length; i++) if (t >= st[i]) k = i; return SHOTS[k].set; };
  for (const l of ys) { assert.strictEqual(setAt(l.at), "home"); assert.strictEqual(setAt(l.at + l.dur - 0.01), "home"); }
});

test("subtitles: Arabic and English for every line, no overlaps, all inside the sequence; the title is exact", async () => {
  const { PROLOGUE } = await storyMod(); const { DURATION } = await shotsMod();
  let end = 0;
  for (const l of PROLOGUE.subtitles) {
    assert.ok(l.text.ar && l.text.en && l.who.ar && l.who.en);
    assert.ok(/[\u0600-\u06FF]/.test(l.text.ar) && !/[\u0600-\u06FF]/.test(l.text.en));
    assert.ok(l.at >= end, "no overlap at " + l.at); end = l.at + l.dur; assert.ok(end <= DURATION);
  }
  assert.strictEqual(PROLOGUE.title.ar, "مجتمع — الموسم الأول: الإشارة");
});

test("the shots play through the sequencer: every shot entered once, complete once, camera ends on the last framing", async () => {
  const { Sequence } = await cinemaMod(); const { worldShots, DURATION } = await shotsMod(); const { PROLOGUE } = await storyMod();
  const cam = { position: { x: 0, y: 0, z: 0 }, setTarget() { } };
  const seen = [], subs = []; let done = 0;
  const shots = worldShots();
  const s = new Sequence({ camera: cam, shots, subtitles: PROLOGUE.subtitles, lang: "ar", onShot: (i) => seen.push(i), onSubtitle: (l) => l && subs.push(l.dir), onComplete: () => done++ }).start();
  for (let t = 0; t < DURATION + 2; t += 1 / 30) s.update(1 / 30);
  assert.deepStrictEqual(seen, shots.map((_, i) => i)); assert.strictEqual(done, 1);
  assert.strictEqual(subs.length, PROLOGUE.subtitles.length); assert.ok(subs.every((d) => d === "rtl"));
  const last = shots.at(-2).to.pos; [cam.position.x, cam.position.y, cam.position.z].forEach((v, i) => assert.ok(Math.abs(v - last[i]) < 1e-6, "the final hold keeps the last framing"));
});

test("integration guards: one WebGL context, nothing saved, room/street/tower/renderer untouched by the prologue", () => {
  const src = fs.readFileSync(path.join(G, "scenes", "prologue.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(/new Engine\(gl\b/.test(src), "Babylon on the existing context");
  assert.ok(!/makeEngine|createElement\(\s*["']canvas/.test(src), "no second canvas");
  assert.ok(!/save\.set|save\.flush|\/api\//.test(src), "the prologue writes no save and calls no API");
  const sets = fs.readFileSync(path.join(G, "bjs", "prologue-sets.js"), "utf8");
  assert.ok(!/save\.|\/api\/|from "three"/.test(sets));
  const idx = fs.readFileSync(path.join(G, "scenes", "index.js"), "utf8"); assert.match(idx, /prologue: .*import\("\.\/prologue\.js"\)/); assert.match(idx, /prologue: .*import\("\.\/prologue-px\.js"\)/); // pixel by default, 3D kept
  const cr = fs.readFileSync(path.join(G, "scenes", "creator.js"), "utf8"); assert.match(cr, /go\("prologue", \{[^}]*next: "room", nextParams: \{ arrival: true/);
});
