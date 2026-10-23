/* v2.62 «الحارس التلقائي» T1 — guard config parsing + word/phrase matching with exceptions (server/lib/automod-rules.js).
 * Pure unit tests: no DB, no server. The existing v2 rules (`matchWords`, `parseV2`, `evaluate`) must stay unchanged. */
const test = require("node:test"), assert = require("node:assert");
const AR = require("../lib/automod-rules");

const G = (o) => AR.parseGuard({ enabled: true, ...o });

test("parseGuard: OFF by default, safe defaults, unknown keys dropped", () => {
  for (const b of [undefined, null, {}, [], "x", 5, { enabled: "true" }, { enabled: 1 }]) {
    const g = AR.parseGuard(b);
    assert.equal(g.enabled, false);
    assert.deepEqual(g, { ...AR.GUARD_DEF, words: [], allow: [] });
  }
  assert.equal(AR.parseGuard({ enabled: true }).enabled, true);
  assert.equal("evil" in AR.parseGuard({ evil: 1 }), false);
  assert.ok(Object.isFrozen(AR.GUARD_DEF));
});

test("parseGuard: clamps and lists", () => {
  const g = AR.parseGuard({ muteHours: 9999, maxStrikes: 0, decayDays: -5, liftMin: "root", fullLock: false, comments: false, edits: "no", words: "غبي\nغبي،  يا حمار ,", allow: Array.from({ length: 150 }, (_, i) => "w" + i) });
  assert.equal(g.muteHours, 720); assert.equal(g.maxStrikes, 1); assert.equal(g.decayDays, 0); assert.equal(g.liftMin, "moderator");
  assert.equal(g.fullLock, false); assert.equal(g.comments, false); assert.equal(g.edits, true, "non-boolean keeps default");
  assert.deepEqual(g.words, ["غبي", "يا حمار"]); assert.equal(g.allow.length, 100);
  assert.equal(AR.parseGuard({ maxStrikes: 50, muteHours: 0, decayDays: 400 }).maxStrikes, 10);
  assert.equal(AR.parseGuard({ muteHours: 0 }).muteHours, 0, "0 = warning only");
  assert.equal(AR.parseGuard({ decayDays: 400 }).decayDays, 365);
  assert.equal(AR.parseGuard({ muteHours: "abc" }).muteHours, 1);
  assert.equal(AR.parseGuard({ words: Array.from({ length: 400 }, (_, i) => "ك" + i) }).words.length, 300);
  assert.equal(AR.parseGuard({ words: ["x".repeat(100)] }).words[0].length, 60);
  for (const r of AR.LIFT_MIN) assert.equal(AR.parseGuard({ liftMin: r }).liftMin, r);
});

test("GUARD_PRESET is the recommended setup and parses cleanly", () => {
  const g = AR.parseGuard(AR.GUARD_PRESET.guard);
  assert.equal(g.enabled, true); assert.equal(g.maxStrikes, 3); assert.equal(g.muteHours, 1); assert.equal(g.decayDays, 30); assert.equal(g.fullLock, true);
  assert.deepEqual(g.words, [], "the preset never invents words");
});

test("guardApplies: needs enabled + words + kind switch", () => {
  assert.equal(AR.guardApplies(AR.parseGuard({ words: ["غبي"] })), false, "OFF");
  assert.equal(AR.guardApplies(G({})), false, "no words");
  const g = G({ words: ["غبي"], comments: false });
  assert.equal(AR.guardApplies(g, "post"), true); assert.equal(AR.guardApplies(g, "comment"), false); assert.equal(AR.guardApplies(g, "edit"), true);
  assert.equal(AR.guardApplies(null), false);
});

test("matchGuard: words, wildcard, obfuscation, clitics", () => {
  const g = G({ words: ["غب*", "حمار"] });
  for (const t of ["انت غبي", "الغبي", "وغبية", "غبيييي", "غ.ب.ي", "غَبِيّ", "يا حماااار", "والحمار"]) assert.equal(AR.matchGuard(t, g).hit, true, t);
  for (const t of ["", "نص عادي", "غ", "حمارة"]) assert.equal(AR.matchGuard(t, g).hit, false, t);
  assert.deepEqual(AR.matchGuard("انت غبي يا حمار", g).words, ["غب*", "حمار"], "original spelling returned");
});

test("matchGuard: phrases with * and clitics on the first word", () => {
  const g = G({ words: ["يا غ*", "يا حمار"] });
  assert.equal(AR.matchGuard("والله يا غبي", g).hit, true);
  assert.equal(AR.matchGuard("ويا غبي", g).hit, true, "clitic و stripped from the first phrase word");
  assert.equal(AR.matchGuard("فيا غبية", g).hit, true);
  assert.equal(AR.matchGuard("يا حمار", g).hit, true);
  assert.equal(AR.matchGuard("غبي يا", g).hit, false, "order matters");
  assert.equal(AR.matchGuard("يا صديقي غبي", g).hit, false, "adjacent words only");
  assert.equal(AR.matchGuard("حمار", G({ words: ["يا حمار"] })).hit, false);
});

test("matchGuard: allow-list exceptions", () => {
  const g = G({ words: ["غب*", "يا غ*"], allow: ["غبار"] });
  assert.equal(AR.matchGuard("الغبار كثير اليوم", g).hit, false, "«غبار» excepted");
  assert.equal(AR.matchGuard("يا غبار", g).hit, false, "a phrase span touching an exception never counts");
  assert.deepEqual(AR.matchGuard("غبار ثم غبي", g).words, ["غب*"], "other occurrences still count");
  assert.equal(AR.matchGuard("ما احلى الجو", G({ words: ["احلى الجو"], allow: ["احلى الجو"] })).hit, false, "phrase exception");
});

test("matchGuard: invalid / too-short patterns are ignored, user input is never a RegExp", () => {
  const g = G({ words: ["*", "**", "غ", "(.*)+", "[a-z", "\\d+"] });
  assert.equal(AR.matchGuard("أي نص (.*)+ هنا", g).hit, false, "regex metacharacters are literal and get normalised away");
  assert.doesNotThrow(() => AR.matchGuard("x".repeat(5000), g));
});

test("matchGuard: 100k characters × 300 wildcard patterns < 50ms", () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let s = ""; while (s.length < 100000) { const n = 2 + Math.floor(rnd() * 7); for (let i = 0; i < n; i++) s += String.fromCharCode(0x628 + Math.floor(rnd() * 20)); s += " "; }
  const g = G({ words: Array.from({ length: 300 }, (_, i) => String.fromCharCode(0x628 + (i % 20)) + "*" + String.fromCharCode(0x628 + ((i * 7) % 20)) + "*ي") });
  AR.matchGuard(s, g); // warm-up
  const t = process.hrtime.bigint(); AR.matchGuard(s, g); const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 50, `took ${ms.toFixed(1)}ms`);
});

test("maskWord hides the list from members", () => {
  assert.equal(AR.maskWord("غبي"), "غ**"); assert.equal(AR.maskWord("يا غ*"), "ي* غ*"); assert.equal(AR.maskWord(""), "");
});

test("guardStep: strike → warning/mute, last strike → full lock (or plain mute)", () => {
  const g = G({ words: ["غبي"] });
  assert.deepEqual(AR.guardStep(1, g), { n: 1, max: 3, hours: 1, locked: false, message: "لم يُنشر نصك لأنه يحتوي عبارة ممنوعة في هذا المجتمع. تحذير 1 من 3 · لا يمكنك الكتابة لمدة ساعة." });
  assert.equal(AR.guardStep(2, g).locked, false);
  const l = AR.guardStep(3, g); assert.equal(l.locked, true); assert.equal(l.hours, 0); assert.match(l.message, /تحذير 3 من 3 · أنت موقوف عن الكتابة/);
  assert.equal(AR.guardStep(9, g).n, 3, "capped at max");
  const soft = AR.guardStep(3, G({ fullLock: false, muteHours: 24 })); assert.equal(soft.locked, false); assert.equal(soft.hours, 24); assert.match(soft.message, /لمدة يوم/);
  assert.doesNotMatch(AR.guardStep(1, G({ muteHours: 0 })).message, /لا يمكنك/);
});

test("existing v2 rules unchanged: matchWords phrases stay exact, parseV2 has no guard", () => {
  assert.deepEqual(AR.matchWords("والله يا غبي", ["يا غبي"]), ["يا غبي"]);
  assert.deepEqual(AR.matchWords("يا غبي", ["يا غ*"]), [], "v2 phrases still ignore *");
  assert.deepEqual(AR.matchWords("الغبي", ["غب*"]), ["غب*"]);
  assert.equal("guard" in AR.parseV2({ guard: { enabled: true } }), false);
  assert.equal(AR.evaluate(AR.parseV2({}), { text: "غبي" }).action, null);
});
