const test = require("node:test");
const assert = require("node:assert");
const P = require("../lib/compliance-policies");

test("privacy and terms disclose Pi data in Arabic and English, same version and section ids", () => {
  const ar = P.documents({}, undefined, "ar"), en = P.documents({}, undefined, "en");
  for (const slug of ["privacy", "terms"]) {
    const a = ar.find(d => d.slug === slug), e = en.find(d => d.slug === slug);
    assert.equal(e.lang, "en");
    assert.equal(a.version, e.version);
    assert.deepEqual(a.sections.map(s => s.id), e.sections.map(s => s.id));
    assert.ok(a.sections.some(s => s.id === "pi"), slug + " ar has Pi section");
    assert.ok(!/[\u0600-\u06FF]/.test(JSON.stringify(e.sections)), slug + " en has no Arabic text");
  }
  const pa = JSON.stringify(ar.find(d => d.slug === "privacy"));
  assert.match(pa, /عبارة الاسترداد/);
  assert.match(pa, /Pi Network/);
  assert.equal(ar.find(d => d.slug === "retention").lang, undefined);
});
