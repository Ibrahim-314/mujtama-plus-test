/* Phase 2D-A — the game's client missions (game/src/engine/missions.js) and the save's failure handling (engine/save.js):
 * XP shown only from the server's answer, no body sent on completion, story order kept, a repeat skipped, transient
 * failures retried in memory (never stored), refusals not retried, forged local data never sent as XP. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const G = path.join(__dirname, "..", "..", "game", "src");
const mod = (p) => import(pathToFileURL(path.join(G, ...p.split("/"))).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeGame() {
  const toasts = [];
  return { toasts, root: null, save: { data: { level: 1, xp: 0, chapter: 0 } }, ui: { toast: (h) => toasts.push(h) }, audio: { sfx() {} } };
}
const answer = (over = {}) => ({ mission: "c0.explore", completed: true, already: false, xpGained: 100,
  progress: { xp: 100, level: 2, chapter: 0, levelFrom: 100, levelTo: 300, pct: 0 },
  missions: [{ id: "c0.explore", done: true, title: { ar: "استكشف", en: "Explore" } }, { id: "c0.leave", done: false }], ...over });

test("completion sends no body, shows the server's XP, and skips a mission already done", async () => {
  const { Missions } = await mod("engine/missions.js");
  const calls = [], g = fakeGame();
  const m = new Missions(async (meth, p, b) => { calls.push([meth, p, b]); return answer(); }, true, g);
  const r = await m.complete("c0.explore");
  assert.deepEqual(calls, [["POST", "/api/game/missions/c0.explore/complete", undefined]], "no body: nothing to spoof");
  assert.equal(r.xpGained, 100); assert.equal(m.progress.xp, 100); assert.equal(g.save.data.level, 2, "level from the server");
  assert.equal(g.toasts.length, 1);
  assert.equal(await m.complete("c0.explore"), null); assert.equal(calls.length, 1, "done → no second request");
});

test("guests never call the server; local save data never becomes XP", async () => {
  const { Missions } = await mod("engine/missions.js");
  let n = 0; const g = fakeGame(); g.save.data = { level: 40, xp: 99999, flags: { "room.done": true, "street.tower": true } };
  const guest = new Missions(async () => { n++; return answer(); }, false, g);
  assert.equal(await guest.complete("c0.explore"), null); assert.equal(await guest.load(), null); assert.equal(n, 0);
  const member = new Missions(async () => answer({ completed: false, already: true, xpGained: 0, progress: { xp: 0, level: 1, chapter: 0, pct: 0 } }), true, g);
  await member.load(); assert.equal(g.save.data.xp, 0, "the forged local 99999 is replaced by the server's 0"); assert.equal(g.save.data.level, 1);
});

test("calls run in story order; refusals are not retried; transient failures retry in memory", async () => {
  const { Missions } = await mod("engine/missions.js");
  const order = [];
  const slow = new Missions(async (_m, p) => { const id = p.split("/")[4]; await sleep(id === "c0.explore" ? 30 : 1); order.push(id); return answer({ mission: id }); }, true, fakeGame());
  await Promise.all([slow.complete("c0.explore"), slow.complete("c0.leave")]);
  assert.deepEqual(order, ["c0.explore", "c0.leave"]);
  let n = 0;
  const locked = new Missions(async () => { n++; throw Object.assign(new Error("locked"), { status: 409 }); }, true, fakeGame());
  assert.equal(await locked.complete("c1.tower"), null); await sleep(20); assert.equal(n, 1, "a 409 is final");
  const timers = []; const realST = global.setTimeout;
  global.setTimeout = (fn, ms) => { timers.push(ms); return realST(fn, 0); };
  try {
    let k = 0;
    const flaky = new Missions(async () => { k++; if (k < 3) throw Object.assign(new Error("down"), { status: 503 }); return answer(); }, true, fakeGame());
    await flaky.complete("c0.explore"); await new Promise((r) => realST(r, 60));
    assert.equal(k, 3, "two retries"); assert.equal(flaky.progress.xp, 100); assert.deepEqual(timers.slice(0, 2), [4000, 15000]);
  } finally { global.setTimeout = realST; }
});

test("save: a transient failure keeps the change under newer ones and retries; a refusal is dropped", async () => {
  globalThis.localStorage = { s: {}, getItem(k) { return this.s[k] ?? null; }, setItem(k, v) { this.s[k] = v; } };
  const { Save } = await mod("engine/save.js");
  const sent = []; let fail = 1;
  const s = new Save(async (_m, _p, b) => { sent.push(b); if (fail-- > 0) throw Object.assign(new Error("offline"), { status: 0 }); return { player: { ...b, xp: 0, level: 1 } }; }, true);
  s.data = { char: "hoodie", name: "Sami" };
  s.set({ flags: { "room.door": true } }); await s.flush();
  assert.ok(s.queue, "requeued"); s.set({ flags: { "room.bed": true }, scene: "room" }); await s.flush();
  assert.deepEqual(sent.at(-1).flags, { "room.door": true, "room.bed": true }, "nothing lost, newer on top");
  const bad = new Save(async () => { throw Object.assign(new Error("bad"), { status: 400 }); }, true);
  bad.data = { char: "hoodie", name: "Sami" }; bad.set({ scene: "moon" }); await bad.flush();
  assert.equal(bad.queue, null, "a 400 is not retried (no loop)"); clearTimeout(s.timer); clearTimeout(bad.timer);
});
