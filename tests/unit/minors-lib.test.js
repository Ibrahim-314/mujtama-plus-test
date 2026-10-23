/* Phase 35 — pure rules in minors-core.js (shared by server and browser): age arithmetic incl. leap days,
 * bands and the age gate, label normalization, the per-viewer show/cover/hide decision, minor floors and
 * guardian controls (tighten-only), and the severity heuristic that orders the escalation queue. */
const test = require("node:test"), assert = require("node:assert");
const M = require("../../minors-core.js");
const D = (s) => new Date(s + "T12:00:00Z");

test("ageOn / parseBirthDate: calendar ages, leap days, invalid and future dates", () => {
  assert.equal(M.ageOn("2010-10-16", D("2026-10-16")), 16);
  assert.equal(M.ageOn("2010-10-17", D("2026-10-16")), 15);
  assert.equal(M.ageOn("2008-02-29", D("2026-02-28")), 17, "29 Feb birthday not yet reached on 28 Feb");
  assert.equal(M.ageOn("2008-02-29", D("2026-03-01")), 18);
  assert.equal(M.birthdayAt("2008-02-29", 18), "2026-03-01");
  assert.equal(M.birthdayAt("2010-10-16", 18), "2028-10-16");
  assert.equal(M.parseBirthDate("2010-02-30", D("2026-10-16")), null);
  assert.equal(M.parseBirthDate("2027-01-01", D("2026-10-16")), null);
  assert.equal(M.parseBirthDate("1890-01-01", D("2026-10-16")), null);
  assert.equal(M.parseBirthDate("16/10/2010"), null);
  assert.equal(M.parseBirthDate(" 2010-10-16 ", D("2026-10-16")), "2010-10-16");
  assert.equal(M.ageOn(null), null);
});

test("band: child below the minimum age, teen 13–17, adult 18+, unknown", () => {
  assert.equal(M.band(12), "child"); assert.equal(M.band(13), "teen"); assert.equal(M.band(17), "teen"); assert.equal(M.band(18), "adult");
  assert.equal(M.band(null), "unknown"); assert.equal(M.band(14, 15), "child", "operator may raise the minimum age");
  assert.ok(M.isMinor("teen") && M.isMinor("child") && !M.isMinor("adult") && !M.isMinor("unknown"));
});

test("labels: only known labels, unique, max 4; media labels by index 0–9", () => {
  assert.deepEqual(M.normalizeLabels(["Graphic", "violence", "x", "violence"]), ["violence", "graphic"]);
  assert.deepEqual(M.normalizeLabels("adult,spoiler"), ["adult", "spoiler"]);
  assert.deepEqual(M.normalizeLabels(M.LABEL_KEYS).length, 4);
  assert.deepEqual(M.normalizeMediaLabels({ 0: ["medical"], 12: ["adult"], "-1": ["adult"], 2: [] }), { 0: ["medical"] });
  assert.deepEqual(M.allLabels({ post: ["violence"], media: { 1: ["medical", "violence"] } }).sort(), ["medical", "violence"]);
});

test("decide: minors never see restricted content, unknown age never sees adult-only, preferences for adults, own posts always shown", () => {
  const teen = { band: "teen", pref: "hide" }, unk = { band: "unknown", pref: "blur" }, adult = { band: "adult", pref: "blur" };
  const L = (post, media = {}) => ({ labels: { post, media } });
  assert.equal(M.decide(teen, L(["violence"])), "hide");
  assert.equal(M.decide(teen, L([], { 0: ["medical"] })), "hide", "media labels count");
  assert.equal(M.decide(teen, L(["spoiler"])), "cover", "spoilers are mild");
  assert.equal(M.decide(teen, { labels: null, sensitive: true }), "hide", "legacy keyword flag");
  assert.equal(M.decide(teen, L([])), "show");
  assert.equal(M.decide(unk, L(["adult"])), "hide"); assert.equal(M.decide(unk, L(["violence"])), "cover");
  assert.equal(M.decide(adult, L(["adult"])), "cover");
  assert.equal(M.decide({ band: "adult", pref: "show" }, L(["adult"])), "show");
  assert.equal(M.decide({ band: "unknown", pref: "show" }, L(["violence"])), "cover", "show requires a declared adult");
  assert.equal(M.decide({ band: "adult", pref: "hide" }, L(["violence"])), "hide");
  assert.equal(M.decide({ band: "adult", pref: "hide" }, L(["spoiler"])), "cover");
  assert.equal(M.decide(teen, { own: true, ...L(["adult"]) }), "show");
  assert.equal(M.decide(undefined, L(["graphic"])), "hide", "no viewer = unknown age");
});

test("minor floors and guardian controls only tighten", () => {
  assert.equal(M.stricter("everyone", "following"), "following"); assert.equal(M.stricter("nobody", "following"), "nobody");
  const floor = { dm: "following", mentions: "following" };
  assert.equal(M.allowedForMinor("dm", "everyone", floor), false); assert.equal(M.allowedForMinor("dm", "nobody", floor), true);
  assert.equal(M.allowedForMinor("comments", "everyone", floor), true, "no floor for comments by default");
  assert.deepEqual(M.normalizeControls({ dm: "everyone", comments: "nobody", mentions: "following", private: false, location: true }), { comments: "nobody", mentions: "following" }, "a guardian cannot open DMs to everyone");
  assert.equal(M.MINOR_DEFAULTS.private, true); assert.equal(M.MINOR_DEFAULTS.location, false);
});

test("severity heuristic: Arabic (with diacritics/hamza variants) and English, categories, minor involvement", () => {
  const c1 = M.classifySeverity("حالة استِغلال جنسي لطفل"); assert.equal(c1.severity, "critical"); assert.equal(c1.category, "child_safety");
  assert.equal(M.classifySeverity("This looks like grooming of a kid").severity, "critical");
  const s = M.classifySeverity("قال إنه يريد الانتحار"); assert.equal(s.severity, "high"); assert.equal(s.category, "self_harm");
  assert.equal(M.classifySeverity("تهديد بالقتل في التعليقات").category, "violent_threat");
  assert.equal(M.classifySeverity("ابتزاز مالي").category, "exploitation"); assert.equal(M.classifySeverity("ابتزاز مالي").severity, "critical");
  const n = M.classifySeverity("محتوى مزعج"); assert.equal(n.severity, "normal"); assert.equal(n.category, "other");
  assert.equal(M.classifySeverity("مزعج", { minorInvolved: true }).severity, "high");
  assert.equal(M.classifySeverity("", { category: "child_safety" }).severity, "high");
  assert.equal(M.classifySeverity("", { category: "self_harm" }).severity, "high");
  assert.equal(M.classifySeverity("cse class schedule").severity, "normal", "no false positive on short tokens");
});

test("priority: severity dominates, older first within a severity", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const crit = M.priority("critical", "2026-10-16T11:00:00Z", now), high = M.priority("high", "2026-10-01T00:00:00Z", now);
  assert.ok(crit > high); assert.ok(M.priority("high", "2026-10-15T00:00:00Z", now) > M.priority("high", "2026-10-16T11:00:00Z", now));
  assert.ok(M.SLA_MIN.critical < M.SLA_MIN.high && M.SLA_MIN.high < M.SLA_MIN.normal);
});
