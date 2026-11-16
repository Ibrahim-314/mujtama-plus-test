/* v2.149.7 fix #1 (community settings audit 2026-11-16): «يوم» as a duration choice (mute, lockdown, automod)
 * showed «days» in English because i18n-enplus.js repeated the key of i18n-en.js with a different value.
 * The duration reads «1 day»; the integrity KPI unit label (number above it) keeps «days» through its own key. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.join(__dirname, "..", "..");
function cat() { const ctx = { window: {} }; vm.createContext(ctx); for (const f of ["i18n-en.js", "i18n-enplus.js", "i18n-enextra.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx); return ctx.window.MPI18N.en; }
test("«يوم» duration choice reads «1 day» in English", () => { assert.equal(cat()["يوم"], "1 day"); });
test("integrity KPI unit label still reads «days»", () => {
  assert.equal(cat()["يوم\u200c"], "days");
  assert.match(fs.readFileSync(path.join(ROOT, "integrity-ui.js"), "utf8"), /<\/b>يوم\u200c<\/div>/);
});
