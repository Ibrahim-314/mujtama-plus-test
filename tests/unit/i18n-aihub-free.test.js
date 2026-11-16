/* v2.149.7 fix #2 (community settings audit 2026-11-16): the community AI buttons (suggest rules, write welcome,
 * weekly health report) answer 503 «free use off» / 429 «free limit» when the user has no linked AI account
 * (production has no AIHUB_FREE_KEY). The server message reached the English UI in Arabic: no catalogue entry. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.join(__dirname, "..", "..");
function cat() { const ctx = { window: {} }; vm.createContext(ctx); for (const f of ["i18n-en.js", "i18n-enplus.js", "i18n-enextra.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx); return ctx.window.MPI18N.en; }
const src = fs.readFileSync(path.join(ROOT, "server/services/aihub.js"), "utf8");
test("503 free-use-off message has an English entry", () => {
  const off = src.match(/const OFF_FREE = "([^"]+)"/)[1];
  assert.equal(cat()[off], "Free use isn't on yet. Link your account to start.");
});
test("429 free-limit message has an English template", () => {
  const msg = src.match(/fail\(429, "free_limit", `([^`]+)`/)[1].replace(/\$\{st\.freeDaily\}/g, "{n}");
  assert.equal(cat()[msg], "You've used {n} of {n} free requests today. Link your account to keep going with no app limit, or come back tomorrow.");
});
