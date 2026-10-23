/* v2.69 — guard: no new Arabic UI string may ship without an English translation. */
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("every new Arabic UI string has an English translation (i18n-coverage)", () => {
  const root = path.resolve(__dirname, "../..");
  let out = "";
  try {
    out = execFileSync(process.execPath, ["tools/i18n-coverage.mjs"], { cwd: root, encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    assert.fail(String(e.stdout || "") + String(e.stderr || ""));
  }
  assert.match(out, /i18n-coverage: OK/);
});
