/* Season 1 «الإشارة»: the prologue tells the story in order and the street's first story beat (Salma) is complete. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path");
const G = path.join(__dirname, "..", "..", "game", "src");
const load = async (f) => import(path.join(G, f));
test("prologue subtitles: key 40, the city and its golden tower, the signal — in that order", async () => {
  const { PROLOGUE } = await load("story/prologue.js");
  const ar = PROLOGUE.subtitles.map((l) => l.text.ar);
  const i = (re) => ar.findIndex((x) => re.test(x));
  const msg = i(/الطابق الأربعين/), key = i(/رقم 40/), train = i(/القطار المغناطيسي/), tower = i(/برج MJT الذهبي/), signal = i(/إشارة مجهولة/);
  assert.ok(msg >= 0 && key > msg && train > key && tower > train && signal > tower, JSON.stringify({ msg, key, train, tower, signal }));
});
test("chapter 1: Salma's beat names Yousuf and the fortieth floor, every line in Arabic and English", async () => {
  const { CHAPTER1: C } = await load("story/chapter1.js");
  const lines = C.salma.flatMap((b) => b.lines);
  assert.ok(lines.length >= 6);
  for (const l of lines) { assert.ok(/[\u0600-\u06FF]/.test(l.ar) && l.en && !/[\u0600-\u06FF]/.test(l.en)); }
  const all = lines.map((l) => l.ar).join(" ");
  assert.match(all, /يوسف/); assert.match(all, /الطابق الأربعين/); assert.match(all, /40/);
  assert.ok(C.salma.every((b) => ["salma", "narrator"].includes(b.who)));
  assert.ok(C.next.objective.ar.includes("40") && C.next.objective.en && C.salmaName.ar.includes("سلمى"));
});
