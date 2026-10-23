/* v2.82 chapters parser (video/player/chapters.js) */
const test = require("node:test"), assert = require("node:assert");
const C = require("../../video/player/chapters.js");
test("chapters: valid description", () => {
  const t = "شرح كامل\n0:00 مقدمة\n1:05 - الفكرة الأساسية\n(12:30) التطبيق\n1:02:03 | الخلاصة";
  assert.deepEqual(C.parse(t), [{ t: 0, title: "مقدمة" }, { t: 65, title: "الفكرة الأساسية" }, { t: 750, title: "التطبيق" }, { t: 3723, title: "الخلاصة" }]);
});
test("chapters: rules — ≥2, starts at 0:00, increasing, ≥5 s apart, valid seconds", () => {
  assert.deepEqual(C.parse("0:00 فقط"), []);
  assert.deepEqual(C.parse("0:10 أ\n1:00 ب"), [], "first must be 0:00");
  assert.deepEqual(C.parse("0:00 أ\n0:03 ب"), [], "too close");
  assert.deepEqual(C.parse("0:00 أ\n2:00 ب\n1:00 ج"), [], "not increasing");
  assert.deepEqual(C.parse("0:00 أ\n1:75 ب"), [], "bad seconds line ignored → one chapter");
  assert.deepEqual(C.parse(""), []); assert.deepEqual(C.parse(null), []);
});
test("chapters: beyond the duration are dropped; title capped", () => {
  assert.deepEqual(C.parse("0:00 a\n0:30 b\n5:00 c", 60).map(c => c.t), [0, 30]);
  assert.deepEqual(C.parse("0:00 a\n5:00 c", 60), []);
  assert.equal(C.parse("0:00 " + "x".repeat(80) + "\n1:00 b")[0].title.length, 60);
  assert.equal(C.fmt(3723), "1:02:03"); assert.equal(C.fmt(65), "1:05");
});

test("v2.82 poster prefers WebP, falls back to JPEG and the legacy field", () => {
  const S = require("../../video/player/sources.js");
  assert.equal(S.poster({ variants: { poster: "a.jpg", posterWebp: "a.webp" } }), "a.webp");
  assert.equal(S.poster({ variants: { poster: "a.jpg" } }), "a.jpg");
  assert.equal(S.poster({ poster: "old.jpg" }), "old.jpg");
  assert.equal(S.poster({ posterWebp: "v.webp", poster: "v.jpg" }), "v.webp", "a variants object works too");
  assert.equal(S.poster(null), ""); assert.equal(S.poster(undefined), "");
});
