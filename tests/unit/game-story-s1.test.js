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

test("Season 1 «الإشارة الأولى»: the terminal, Yousuf's fragment and Sada — Arabic + English, short, no mirror spoiler", async () => {
  const { CHAPTER1: C } = await load("story/chapter1.js");
  assert.ok(Array.isArray(C.signal) && C.signal.length >= 3);
  const whos = C.signal.map((b) => b.who);
  for (const w of ["narrator", "yousuf", "sada"]) assert.ok(whos.includes(w), w);
  const all = C.signal.flatMap((b) => b.lines);
  for (const l of all) { assert.ok(l.ar && l.en, "both languages"); assert.ok(/[\u0600-\u06FF]/.test(l.ar)); assert.ok(l.ar.length < 140, "short lines"); }
  const ar = all.map((l) => l.ar).join(" "), en = all.map((l) => l.en).join(" ").toLowerCase();
  assert.ok(ar.includes("صدى") && ar.includes("يوسف") && /40|أربعون/.test(ar), "Sada, Yousuf and the fortieth floor");
  assert.ok(!/مرآة|المرآة/.test(ar) && !en.includes("mirror"), "the mirror stays hidden");
  assert.ok(C.sadaName.ar === "صدى" && C.yousufName.ar.includes("يوسف"));
  assert.ok(C.after.objective.ar.includes("MJT") && C.after.goal.ar.includes("40"), "next objective ties back to the tower and key 40");
  assert.ok(C.things.signal.label.ar && C.things.signal.verb.ar);
  assert.ok(C.next.hint.ar.includes("محطة"), "Salma's beat points at the terminal");
});

test("Season 1 Phase 3 «السوق السفلي»: route, Abu Nasser, two choices, the record and the service entrance", async () => {
  const { CHAPTER1: C } = await load("story/chapter1.js");
  const beats = [...C.route, ...C.nasser, ...C.byKey, ...C.bySignal, ...C.record];
  for (const l of beats.flatMap((b) => b.lines)) { assert.ok(l.ar && l.en, "both languages"); assert.ok(/[\u0600-\u06FF]/.test(l.ar)); assert.ok(l.ar.length < 140, "short lines"); }
  assert.ok(C.route.flatMap((b) => b.lines).some((l) => l.ar.includes("السوق السفلي")) && C.route.every((b) => b.who === "sada"), "Sada finds the route");
  assert.ok(C.nasserName.ar.includes("أبو ناصر"));
  assert.ok(C.choice.key.ar && C.choice.signal.ar && C.choice.key.ar !== C.choice.signal.ar, "two distinct choices");
  const k = C.byKey.flatMap((b) => b.lines).map((l) => l.ar).join(" "), s = C.bySignal.flatMap((b) => b.lines).map((l) => l.ar).join(" ");
  assert.ok(k.includes("40") && s.includes("تردد") && k !== s, "the two branches reveal different things");
  const r = C.record.flatMap((b) => b.lines).map((l) => l.ar).join(" ");
  assert.ok(r.includes("مدخل الخدمة") && r.includes("ثلاثة أيام") && C.record.some((b) => b.who === "fragment") && r.includes("داخل برج MJT"), "record, clue, voice fragment");
  const all = beats.flatMap((b) => b.lines).map((l) => l.ar + " " + l.en.toLowerCase()).join(" ");
  assert.ok(!/مرآة|mirror/.test(all), "no mirror spoiler");
  assert.ok(C.serviceNext.objective.ar.includes("مدخل الخدمة") && C.routeNext.objective.ar.includes("السوق"));
  assert.ok(C.things.market.label.ar && C.things.market.verb.ar);
});
