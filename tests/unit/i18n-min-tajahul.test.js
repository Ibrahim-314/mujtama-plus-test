/* v2.149.8 (2026-11-17): «من» and «تجاهل» were defined twice (i18n-en.js and i18n-enplus.js, the later one wins).
 * «من» is always «from» in the app (date ranges, tips/transfers from @user, MJT from N supporters); the dead «of» copy goes.
 * «تجاهل» on the unsaved-changes bar of community settings reads «Discard»; on a suggested reply (creation) it reads «Skip» through its own key. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.join(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
function cat() { const ctx = { window: {} }; vm.createContext(ctx); for (const f of ["i18n-en.js", "i18n-enplus.js", "i18n-enextra.js"]) vm.runInContext(read(f), ctx); return ctx.window.MPI18N.en; }
const count = (k) => ["i18n-en.js", "i18n-enplus.js", "i18n-enextra.js"].reduce((n, f) => n + (read(f).split(`\n"${k}":`).length - 1), 0);
test("«من» reads «from» and is defined once", () => { assert.equal(cat()["من"], "from"); assert.equal(count("من"), 1); });
test("«تجاهل» (unsaved changes bar) reads «Discard» and is defined once", () => {
  assert.equal(cat()["تجاهل"], "Discard"); assert.equal(count("تجاهل"), 1);
  assert.match(read("cadmin-ui.js"), /data-ca="discard">تجاهل<\/button>/);
});
test("suggested reply «تجاهل» reads «Skip» through its own key", () => {
  assert.equal(cat()["تجاهل\u200c"], "Skip");
  assert.match(read("creation-ui.js"), /data-skip>تجاهل\u200c<\/button>/);
});
