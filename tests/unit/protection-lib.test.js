/* Phase 33 — protection-core.js (shared by browser and server) + help-center content sanity. */
const test = require("node:test"), assert = require("node:assert");
const P = require("../../protection-core.js");
const HELP = require("../../server/lib/help-center.js");

test("normalize folds Arabic forms, tashkeel, tatweel, digits and long repeats", () => {
  assert.equal(P.normalize("إِسَاءَة"), P.normalize("اساءه")); assert.equal(P.normalize("إِسَاءَة"), "اساه"); // standalone hamza dropped, as in lib/arabic.js
  assert.equal(P.normalize("مـــرحبا"), "مرحبا");
  assert.equal(P.normalize("رقم ٩١١"), "رقم 911");
  assert.equal(P.normalize("ههههههه!!!"), "هه");
  assert.equal(P.normalize(null), "");
});

test("wordHit: substring by default, whole word with Arabic proclitics, no false hits inside other words", () => {
  assert.ok(P.wordHit("هذه الإساءة مرفوضة", "اساءه"));
  assert.ok(P.wordHit("وبالإساءة", "إساءة", true), "وبال… proclitic");
  assert.ok(P.wordHit("قال: إساءة!", "إساءة", true));
  assert.ok(!P.wordHit("الإساءات كثيرة", "إساءة", true), "plural form is a different word in whole-word mode");
  assert.ok(P.wordHit("الإساءات كثيرة", "إساء"), "substring mode");
  assert.ok(!P.wordHit("كلبشة", "كلب", true));
  assert.ok(P.wordHit("SPOILER alert", "spoiler", true));
});

test("muteHit: kinds, scopes, expiry, hashtags with/without ال", () => {
  const now = Date.now();
  const rules = [
    { kind: "word", value: "حرق", scope: "feed" },
    { kind: "hashtag", value: "#الدوري", scope: "all" },
    { kind: "user", value: "u_1", scope: "notifications", expiresAt: new Date(now + 1000).toISOString() },
    { kind: "word", value: "قديم", scope: "all", expires_at: new Date(now - 1).toISOString() }
  ];
  assert.deepEqual(P.muteHit({ text: "حرق الحلقة" }, rules, "feed"), { kind: "word", value: "حرق" });
  assert.equal(P.muteHit({ text: "حرق الحلقة" }, rules, "notifications"), null);
  assert.equal(P.muteHit({ text: "نتائج #دوري اليوم" }, rules, "feed").kind, "hashtag");
  assert.equal(P.muteHit({ author: "u_1" }, rules, "notifications").kind, "user");
  assert.equal(P.muteHit({ author: "u_1" }, rules, "feed"), null);
  assert.equal(P.muteHit({ text: "شيء قديم" }, rules, "feed"), null, "expired rule");
  assert.equal(P.muteHit({ author: "u_1" }, rules, "notifications", now + 5000), null, "expires later");
  assert.equal(P.muteHit({ text: "x" }, []), null);
});

test("expiryFor / durations", () => {
  const at = Date.UTC(2026, 9, 16);
  assert.equal(P.expiryFor("1d", at), new Date(at + 864e5).toISOString());
  assert.equal(P.expiryFor("forever", at), null);
  assert.deepEqual(Object.keys(P.DURATION_LABELS), Object.keys(P.DURATIONS));
});

test("canReply: audiences, mentioned always allowed, author always allowed, community without community → followers", () => {
  const base = { actor: "a", author: "b" };
  assert.ok(P.canReply({ ...base, audience: "everyone" }));
  assert.ok(P.canReply({ actor: "b", author: "b", audience: "mentioned" }));
  assert.ok(!P.canReply({ ...base, audience: "followers" }));
  assert.ok(P.canReply({ ...base, audience: "followers", followsAuthor: true }));
  assert.ok(P.canReply({ ...base, audience: "followers", authorFollows: true }));
  assert.ok(!P.canReply({ ...base, audience: "mentioned", followsAuthor: true }));
  assert.ok(P.canReply({ ...base, audience: "mentioned", mentioned: true }));
  assert.ok(P.canReply({ ...base, audience: "community", hasCommunity: true, member: true }));
  assert.ok(!P.canReply({ ...base, audience: "community", hasCommunity: true, followsAuthor: true }));
  assert.ok(P.canReply({ ...base, audience: "community", hasCommunity: false, followsAuthor: true }));
  assert.ok(P.canReply({ ...base, audience: "bogus" }), "unknown audience falls back to everyone");
});

test("trustedDuringProtection: owner follows, or followed before the mode started", () => {
  const start = "2026-10-16T10:00:00.000Z";
  assert.ok(P.trustedDuringProtection({ ownerFollows: true }));
  assert.ok(P.trustedDuringProtection({ followedAt: "2026-10-01T00:00:00Z", startedAt: start }));
  assert.ok(!P.trustedDuringProtection({ followedAt: "2026-10-16T10:05:00Z", startedAt: start }));
  assert.ok(!P.trustedDuringProtection({ followedAt: null, startedAt: start }));
  assert.equal(P.limitFor("comments"), "replies"); assert.equal(P.limitFor("dm"), "dms"); assert.equal(P.limitFor("mentions"), "mentions"); assert.equal(P.limitFor("x"), null);
});

test("detectWave: strangers burst, toxic actors, window, repeated actor counted once", () => {
  const at = Date.now();
  const ev = (actor, o = {}) => ({ at: at - 1000, actor, stranger: true, toxic: 0, ...o });
  assert.equal(P.detectWave([], {}, at).wave, false);
  const burst = Array.from({ length: 16 }, (_, i) => ev("s" + (i % 9)));
  const w = P.detectWave(burst, {}, at); assert.equal(w.wave, true); assert.deepEqual(w.reasons, ["strangers"]); assert.equal(w.strangers, 9);
  assert.equal(P.detectWave(Array.from({ length: 30 }, () => ev("same")), {}, at).wave, false, "one noisy account is not a wave");
  const tox = ["a", "b", "c", "d"].map(a => ev(a, { toxic: 0.8, stranger: false }));
  assert.deepEqual(P.detectWave(tox, {}, at).reasons, ["toxic"]);
  assert.equal(P.detectWave(burst.map(e => ({ ...e, at: at - 2 * 3600e3 })), {}, at).wave, false, "outside the window");
  assert.equal(P.detectWave([ev("x"), ev("y"), ev("z")], { minEvents: 3, minStrangers: 3 }, at).wave, true);
});

test("report taxonomy: 3 steps, urgent sub-reasons, self-harm shows help, reason ≤ 200", () => {
  assert.ok(P.REPORT.length >= 8);
  for (const c of P.REPORT) { assert.ok(c.label && c.hint && c.subs.length); for (const s of c.subs) assert.ok(s[0] && s[1]); }
  const t = P.reportReason("harassment", "threat"); assert.equal(t.urgent, true); assert.equal(t.priority, 2); assert.match(t.reason, /تهديد/);
  const sh = P.reportReason("self_harm", "eating"); assert.equal(sh.help, true); assert.equal(sh.priority, 1);
  assert.equal(P.reportReason("spam", "unknown").subcategory, "ads", "unknown sub → first");
  assert.equal(P.reportReason("nope"), null);
  for (const c of P.REPORT) for (const s of c.subs) assert.ok(P.reportReason(c.key, s[0]).reason.length <= 200);
});

test("help center: informational disclaimer, verified numbers carry a source, unknown numbers are placeholders", () => {
  assert.match(HELP.DISCLAIMER, /للتوعية/); assert.match(HELP.DISCLAIMER, /ليس بديلاً/);
  const keys = new Set();
  for (const r of HELP.RESOURCES) {
    assert.ok(!keys.has(r.key)); keys.add(r.key);
    assert.ok(HELP.CATEGORIES[r.category], r.key);
    if (r.phone) { assert.equal(r.verified, true, r.key); assert.match(r.source, /^https:\/\/[a-z0-9.-]+\.(gov\.sa|org)\//, r.key); assert.match(r.phone, /^\d{3,10}$/); }
    if (r.placeholder) { assert.equal(r.phone, null); assert.equal(r.verified, false); }
  }
  assert.deepEqual(HELP.RESOURCES.filter(r => r.phone).map(r => r.phone).sort(), ["116111", "1919", "911", "920033360", "937", "997", "999"].sort());
  const slugs = HELP.ARTICLES.map(a => a.slug); assert.equal(new Set(slugs).size, slugs.length);
  for (const a of HELP.ARTICLES) for (const b of a.body) assert.ok(["p", "ul", "h", "link"].includes(b[0]), a.slug);
  for (const p of HELP.DEFAULT_POLICIES) { assert.match(p.slug, /^[a-z0-9-]+$/); assert.ok(p.body.length > 50); }
});
