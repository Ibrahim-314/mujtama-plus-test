/* v2.59.0 — community automod v2 rules (server/lib/automod-rules.js): one block per rule, Arabic with and without
 * tashkeel, letter obfuscation, wildcards without ReDoS on 100k-character input, and the "everything off by default"
 * contract. Pure functions: no server, no database. */
const test = require("node:test"),
  assert = require("node:assert");
const AR = require("../../server/lib/automod-rules");
const on = (rule, opts = {}) => AR.parseV2({ [rule]: { enabled: true, ...opts } });
const rules = (v2, text, o = {}) => AR.evaluate(v2, { text, ...o }).matches.map((m) => m.rule);
const fast = (fn, ms = 400) => { const t = Date.now(); fn(); const d = Date.now() - t; assert.ok(d < ms, `took ${d} ms`); };

test("defaults: every rule is OFF, an empty / legacy config never matches anything", () => {
  const d = AR.parseV2({});
  for (const [k, r] of Object.entries(d)) assert.equal(r.enabled, false, k + " must be off by default");
  assert.equal(AR.anyOn(d), false);
  for (const t of ["غبي حقير", "https://t.me/x", "@a @bb @cc @dd @ee @ff @gg", "ههههههههههههههههههه", "سأقتلك"]) {
    assert.deepEqual(AR.evaluate(d, { text: t }), { matches: [], action: null });
    assert.deepEqual(AR.evaluate(null, { text: t }), { matches: [], action: null });
    assert.deepEqual(AR.evaluate(undefined, { text: t }), { matches: [], action: null });
  }
  assert.equal(AR.parseLadder({}).enabled, false, "the penalty ladder is off by default");
  assert.equal(AR.parseV2({ words: { enabled: "true" } }).words.enabled, false, "only a real true turns a rule on");
});

test("words: Arabic with and without tashkeel, tatweel, split letters, repeated letters, clitics", () => {
  const v2 = on("words", { words: ["غبي", "تافه جدا"] });
  for (const t of ["انت غبي", "انت غَبِيّ", "غـــبي", "غ.ب.ي", "غ ـ ب ـ ي".replace(/ /g, ""), "غبييييي", "والغبي", "ﻏﺒﻲ", "تافه جدا", "تافهٌ جداً"]) assert.deepEqual(rules(v2, t), ["words"], t);
  for (const t of ["الغباء ليس عيباً", "اهلا بكم", "تافه", "جدا تافه"]) assert.deepEqual(rules(v2, t), [], t);
  const tashkeelWord = on("words", { words: ["غَبِيّ"] });
  assert.deepEqual(rules(tashkeelWord, "غبي"), ["words"], "a word saved with tashkeel matches text without it");
  assert.deepEqual(AR.evaluate(v2, { text: "غبي" }).matches[0].detail, ["غبي"]);
});

test("words: wildcards inside a word, and no ReDoS on 100k-character input", () => {
  const v2 = on("words", { words: ["كل*", "*ب*ث", "ح*ر"] });
  assert.deepEqual(rules(v2, "يا كلاب"), ["words"]); assert.deepEqual(rules(v2, "الكلاب"), ["words"]); assert.deepEqual(rules(v2, "خبيث"), ["words"]); assert.deepEqual(rules(v2, "حقير"), ["words"]);
  assert.deepEqual(rules(v2, "الحر"), ["words"], "* may be empty"); assert.deepEqual(rules(v2, "مرحبا"), []);
  assert.equal(AR.glob("aaaa", "*a*a*a*a*b"), false); assert.equal(AR.glob("abcd", "a*d"), true); assert.equal(AR.glob("ab", "a**b"), true);
  const evil = on("words", { words: ["*a*a*a*a*a*a*a*a*b", "غ*غ*غ*غ*غ*ب", "*"] });
  fast(() => AR.evaluate(evil, { text: "a".repeat(100000) }));
  fast(() => AR.evaluate(evil, { text: "غ".repeat(100000) }));
  fast(() => AR.evaluate(evil, { text: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ".repeat(1600) }));
  fast(() => AR.evaluate(evil, { text: "غغغغغغغغ ".repeat(11000) }));
  assert.deepEqual(rules(on("words", { words: ["*", "**", "a"] }), "any text here"), [], "patterns shorter than 2 letters are ignored");
});

test("links: deny list and allow-only mode, sub-domains, no ReDoS on dotted 100k input", () => {
  const deny = on("links", { domains: ["bad.com", "https://www.Spam.net/x"] });
  assert.deepEqual(rules(deny, "شوفوا https://x.bad.com/a"), ["links"]); assert.deepEqual(rules(deny, "spam.net/offer"), ["links"]);
  assert.deepEqual(rules(deny, "https://good.com"), []); assert.deepEqual(rules(deny, "notbad.com"), [], "a suffix that is not a sub-domain does not match");
  const allow = on("links", { mode: "allow", domains: ["example.org"] });
  assert.deepEqual(rules(allow, "https://docs.example.org/x"), []); assert.deepEqual(rules(allow, "www.other.com"), ["links"]); assert.deepEqual(rules(allow, "بلا روابط"), []);
  fast(() => AR.evaluate(deny, { text: "a.".repeat(50000) })); fast(() => AR.evaluate(allow, { text: ("x".repeat(60) + ".").repeat(1600) }));
  assert.deepEqual(AR.parseV2({ links: { enabled: true, domains: ["not a domain", "ok.sa"] } }).links.domains, ["ok.sa"]);
});

test("invites, mentions, flood", () => {
  const inv = on("invites");
  for (const t of ["انضموا t.me/group", "https://chat.whatsapp.com/abc", "discord.gg/xyz", "https://discord.com/invite/q", "wa.me/9665"]) assert.deepEqual(rules(inv, t), ["invites"], t);
  assert.deepEqual(rules(inv, "https://discord.com/blog"), []); assert.deepEqual(rules(inv, "telegram رائع"), []);
  const men = on("mentions", { max: 3 });
  assert.deepEqual(rules(men, "@a1 @b2 @c3"), []); assert.deepEqual(rules(men, "@a1 @b2 @c3 @d4"), ["mentions"]); assert.deepEqual(rules(men, "@a1 @a1 @a1 @a1 @a1"), [], "the same person counts once");
  assert.deepEqual(rules(men, "@محمد @سارة @علي @نورة"), ["mentions"], "Arabic handles");
  const fl = on("flood", { maxRepeat: 6, maxEmoji: 3 });
  assert.deepEqual(rules(fl, "هههههه"), []); assert.deepEqual(rules(fl, "ههههههههه"), ["flood"]); assert.deepEqual(rules(fl, "😀😀😀😀"), ["flood"]); assert.deepEqual(rules(fl, "مرحبا 😀"), []);
  fast(() => AR.evaluate(fl, { text: "ه".repeat(100000) }));
});

test("duplicate and newMember use the context the service passes; newMember only for posts", () => {
  const dup = on("duplicate");
  assert.deepEqual(rules(dup, "نص", { ctx: { duplicate: true } }), ["duplicate"]); assert.deepEqual(rules(dup, "نص", { ctx: {} }), []);
  const nm = on("newMember", { firstPosts: 2 });
  assert.deepEqual(rules(nm, "x", { ctx: { memberPosts: 0 } }), ["newMember"]); assert.deepEqual(rules(nm, "x", { ctx: { memberPosts: 2 } }), []); assert.deepEqual(rules(nm, "x", { ctx: {} }), [], "unknown count → no match");
  assert.equal(AR.fingerprint("سلام عليكم ورحمة الله"), AR.fingerprint("سَلامٌ عليكم ورحمـــة اللّه"), "fingerprints ignore tashkeel and tatweel");
  assert.notEqual(AR.fingerprint("سلام عليكم ورحمة الله"), AR.fingerprint("سلام عليكم يا جماعة"));
  assert.equal(AR.fingerprint("قصير"), null, "very short texts are not fingerprinted");
});

test("classify: ar-classify over the threshold, chosen categories only, resists obfuscation", () => {
  const c = on("classify", { threshold: 0.6 });
  assert.deepEqual(rules(c, "سأقتلك يا حقير"), ["classify"]); assert.deepEqual(rules(c, "صباح الخير يا أصدقاء"), []);
  assert.deepEqual(rules(c, "سَأَقْتُلُكَ يا حَقِير"), ["classify"], "with tashkeel");
  assert.deepEqual(rules(on("classify", { threshold: 0.6, categories: ["fraud"] }), "سأقتلك يا حقير"), [], "only the chosen categories");
  fast(() => AR.evaluate(c, { text: "ك".repeat(100000) }), 1500);
});

test("comments: rules apply to comments only when «التعليقات» is on; the strongest action wins", () => {
  const w = on("words", { words: ["غبي"] });
  assert.deepEqual(rules(w, "غبي", { kind: "comment" }), []);
  const wc = AR.parseV2({ words: { enabled: true, words: ["غبي"] }, comments: { enabled: true } });
  assert.deepEqual(rules(wc, "غبي", { kind: "comment" }), ["words"]);
  const mix = AR.parseV2({ words: { enabled: true, words: ["غبي"], action: "report" }, invites: { enabled: true, action: "reject" } });
  assert.equal(AR.evaluate(mix, { text: "غبي t.me/x" }).action, "reject"); assert.equal(AR.evaluate(mix, { text: "غبي" }).action, "report");
  assert.deepEqual(AR.parseV2({ comments: { enabled: true } }).comments, { enabled: true }); assert.equal(AR.anyOn(AR.parseV2({ comments: { enabled: true } })), false, "«التعليقات» alone turns nothing on");
});

test("presets and ladder parse to valid configurations", () => {
  for (const [k, p] of Object.entries(AR.PRESETS)) { const v = AR.parseV2(p.v2); assert.ok(AR.anyOn(v), k); assert.ok(p.t && p.sub); }
  const l = AR.parseLadder({ enabled: true, windowDays: 9999, steps: [{ at: 5, action: "mute", hours: 99999 }, { at: 2, action: "warn" }, { at: 2, action: "ban" }, { at: 9, action: "evil" }] });
  assert.equal(l.windowDays, 365); assert.deepEqual(l.steps.map((s) => s.at), [2, 5, 9]); assert.equal(l.steps[1].hours, 720); assert.equal(l.steps[2].action, "warn");
});
