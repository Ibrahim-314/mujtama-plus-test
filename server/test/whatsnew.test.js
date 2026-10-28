/* v2.124 release-notes guard: the newest entry in public/whatsnew.json must be the app version, entries newest-first with
 * unique versions and both languages — so «يوجد تحديث» / «تم التحديث» never show an old version's notes. */
const test = require("node:test"), assert = require("node:assert"), path = require("path");
test("whatsnew.json matches the app version", () => {
  const list = require(path.join(__dirname, "../../public/whatsnew.json")), ver = require("../../package.json").version;
  assert.equal(list[0].v, ver, "add a whatsnew entry for " + ver);
  assert.equal(require("../package.json").version, ver, "server/package.json version");
  const seen = new Set(); let prev = null;
  for (const x of list) {
    assert.ok(!seen.has(x.v), "duplicate " + x.v); seen.add(x.v);
    assert.ok(x.ar?.title && x.en?.title && x.ar.items?.length && x.en.items?.length, "both languages for " + x.v);
    const n = x.v.split(".").map(Number); if (prev) assert.ok(n[0] < prev[0] || (n[0] === prev[0] && (n[1] < prev[1] || (n[1] === prev[1] && n[2] < prev[2]))), "newest first at " + x.v); prev = n;
  }
});
