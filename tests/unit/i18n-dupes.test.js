/* i18n catalogue (i18n-en.js; v2.67: the app is Arabic + English only) defines each Arabic source key exactly once across the
 * whole file — a key repeated in a later Object.assign block silently overrides the first translation (v2.61 «المكتمل ({n})» regression). */
const test = require("node:test"),
  assert = require("node:assert"),
  path = require("node:path");
const { pathToFileURL } = require("node:url");
const mod = () => import(pathToFileURL(path.join(__dirname, "..", "..", "tools", "i18n-dupes.mjs")).href);

test("detector finds a key repeated across blocks", async () => {
  const { findDupes } = await mod();
  const d = findDupes('w.MPI18N.en = {\n"أ": "A",\n};\nObject.assign(w.MPI18N.en, {\n  "ب": "B",\n  "أ": "A2",\n});');
  assert.deepStrictEqual(d, [{ key: "أ", first: 2, line: 6 }]);
});

test("no i18n catalogue defines a key twice", async () => {
  const { scanAll } = await mod();
  const res = scanAll();
  assert.ok(res.length >= 1, "en catalogue scanned");
  assert.ok(!res.some((r) => /i18n-(fr|ur)\.js$/.test(r.file)), "no retired fr/ur catalogue (v2.67)");
  const bad = res.flatMap((r) => r.dupes.map((d) => `${r.file}:${d.line} ${d.key} (first ${d.first})`));
  assert.deepStrictEqual(bad, []);
});
