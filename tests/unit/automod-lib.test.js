/* Track 7 — Phase 31 unit tests: Arabic classifier (normalisation & evasion: diacritics, elongation, split
 * letters, zero-width, Persian letters, Arabizi, leet; context: targeting, negation, animal words), hate and
 * fraud patterns, link scanner (shorteners, punycode/homoglyphs, look-alikes, userinfo, mismatched display
 * text, rich-text runs, block/allow lists), image skin heuristic, and the client helpers of automod-ui.js. */
const test = require("node:test"),
  assert = require("node:assert");
const C = require("../../server/lib/ar-classify");
const L = require("../../server/lib/linkscan");
const IS = require("../../server/lib/imgscan");

test("classifier: friendly Arabic stays clean; insults, threats, hate and fraud are labelled", () => {
  for (const t of ["صباح الخير يا أصدقاء", "شكراً على الشرح الرائع", "أختلف معك في الرأي", "عندي كلب لطيف اسمه بندق", "Pi Network رائعة"])
    assert.ok(C.classify(t).score < 0.3, t);
  const a = C.classify("انت غبي وحقير");
  assert.equal(a.label, "abuse");
  assert.ok(a.hostile);
  assert.ok(a.targeted);
  assert.equal(C.classify("راح اقتلك").label, "threat");
  assert.ok(C.classify("ساقتلك").categories.threat >= 0.8, "future prefix س");
  assert.ok(C.classify("اعرف وين ساكن").categories.threat >= 0.8);
  const h = C.classify("اللاجئين حشرات ولازم اطردوهم");
  assert.equal(h.label, "hate");
  assert.ok(h.categories.hate >= 0.75);
  const f = C.classify("أرسل عبارة المرور لمحفظتك لتوثيق حسابك");
  assert.equal(f.label, "fraud");
  assert.ok(f.categories.fraud >= 0.8);
  assert.ok(C.classify("ضاعف اموالك الان تواصل واتساب 0555123456").categories.fraud >= 0.7);
});

test("classifier: evasion — diacritics, elongation, separators, zero-width, Persian letters, Arabizi, leet", () => {
  const base = C.classify("انت غبي").categories.abuse;
  for (const t of ["انتَ غَبِيّ", "انت غبيييي", "انت غ.ب.ي", "انت غ ب ي", "انت غ\u200Bبي", "انت غـــبي", "انت غبی"])
    assert.ok(C.classify(t).categories.abuse >= base - 0.15, t);
  assert.ok(C.classify("ya 7mar").hostile);
  assert.ok(C.classify("enta 8abi").categories.abuse >= 0.4);
  assert.ok(C.classify("you are a 1d10t").hostile);
  assert.ok(C.classify("$tupid").categories.abuse >= 0.4);
  assert.equal(C.arabiziSkeleton("7mar"), "حمر");
  assert.equal(C.skeleton("حمار"), "حمر");
  assert.equal(C.deobfuscate("حمااااار"), "حمار");
});

test("classifier: context — negation softens, animal words need a target, explanations are gentle Arabic", () => {
  assert.ok(C.classify("انت مو غبي").categories.abuse < C.classify("انت غبي").categories.abuse);
  assert.ok(C.classify("الكلب نبح في الحديقة").score < 0.3);
  assert.ok(C.classify("يا كلب").hostile);
  assert.deepEqual(C.explain(["abuse", "link", "abuse", "nope"]).length, 2);
  for (const v of Object.values(C.EXPLAIN)) assert.match(v, /[\u0600-\u06FF]/);
});

test("links: shorteners, punycode/homoglyph, look-alikes, userinfo, raw IP, scripts, safe official domains", () => {
  const v = u => L.scan(u).links[0];
  assert.equal(L.scan("زوروا https://minepi.com/blog").verdict, "ok");
  assert.equal(L.scan("https://www.alrajhibank.com.sa/ar").verdict, "ok");
  assert.ok(v("bit.ly/abc123").codes.includes("shortener"));
  assert.ok(v("https://minep1.com/wallet").codes.includes("lookalike"));
  const homo = v("https://mіnepi.com");
  assert.ok(homo.codes.includes("mixed_script") && homo.codes.includes("lookalike"));
  assert.equal(homo.verdict, "malicious");
  assert.ok(v("https://minepi.com@evil.tk/login").codes.includes("userinfo"));
  assert.ok(v("http://192.168.1.4/verify").codes.includes("ip_host"));
  assert.equal(v("javascript:alert(1)").verdict, "malicious");
  assert.equal(L.punyDecode("mnchen-3ya"), "münchen");
  assert.equal(L.registrable("a.b.example.com.sa"), "example.com.sa");
  assert.equal(L.normalizeDomain("https://www.Evil.example/x"), "evil.example");
});

test("links: mismatched display text in Markdown and rich text; admin block and allow lists", () => {
  const m = L.scan("[minepi.com](https://evil.example/x)");
  assert.ok(m.links[0].codes.includes("mismatch"));
  assert.equal(m.verdict, "malicious");
  const doc = { blocks: [{ t: "p", r: [["اضغط هنا: minepi.com", "", "https://bad.tk/x"]] }] };
  assert.ok(L.scan("", doc).links[0].codes.includes("mismatch"));
  assert.equal(L.scan("https://news.example/a").verdict, "ok");
  assert.equal(L.scan("https://news.example/a", null, { bad: ["news.example"] }).verdict, "malicious");
  assert.equal(L.scan("bit.ly/x", null, { allow: ["bit.ly"] }).verdict, "ok");
  assert.equal(L.scan("x https://a.example y https://a.example").count, 1, "deduplicated");
});

test("images: skin heuristic counts skin pixels and the largest region; block-list hamming", () => {
  assert.equal(IS.isSkin(217, 154, 122), true);
  assert.equal(IS.isSkin(48, 96, 192), false);
  assert.equal(IS.isSkin(200, 200, 200), false);
  const w = 10,
    h = 10,
    px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const skin = i % w < 6;
    px[i * 3] = skin ? 217 : 40;
    px[i * 3 + 1] = skin ? 154 : 90;
    px[i * 3 + 2] = skin ? 122 : 200;
  }
  const s = IS.skinStats(px, w, h);
  assert.equal(s.ratio, 0.6);
  assert.equal(s.blob, 0.6);
  assert.equal(IS.hamming("ffff000000000000", "ffff000000000001"), 1);
  assert.match(IS.metaText(Buffer.from("....tEXtComment\0nsfw content here")), /nsfw/);
});

test("client: automod-ui helpers pick what to check and explain gently", () => {
  globalThis.window = globalThis;
  require("../../automod-ui.js");
  const M = globalThis.MPAutomod.lib;
  assert.deepEqual(M.target("POST", "/api/comments", { post: "p1", text: "رد" }), { kind: "comment", text: "رد" });
  assert.equal(M.target("POST", "/api/comments", { post: "p1", text: "رد", parent: "c1" }).kind, "reply");
  assert.equal(M.target("POST", "/api/posts", { text: "نص", quoteOf: "p2" }).kind, "quote");
  assert.equal(M.target("POST", "/api/posts", { repostOf: "p2" }), null);
  assert.equal(M.target("GET", "/api/comments", { text: "x" }), null);
  assert.equal(M.worthChecking("ا"), false);
  assert.equal(M.worthChecking("مرحبا"), true);
  assert.deepEqual(M.explain(["fraud", "fraud"]), [M.EXPLAIN.fraud]);
  for (const s of Object.values(M.STATE)) {
    assert.match(s.title, /[\u0600-\u06FF]/);
    assert.ok(!/مخالف|عقوب/.test(s.body), "no blame wording");
  }
  assert.match(globalThis.MPAutomod.heldBanner({ id: "p_x" }), /role="status"/);
});
