/* v2.82: the security center's passkey and session buttons lost their click handlers in v2.79 — keep them wired. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "secx-ui.js"), "utf8");
test("security center buttons rendered in secx-ui.js all have handlers", () => {
  for (const [ui, wire] of [['id="pk-add"', '$("#pk-add")'], ['data-pk-del="', '[data-pk-del]'], ['data-sess="', '[data-sess]'], ['id="sess-all"', '$("#sess-all")'], ['id="tfa-on"', '$("#tfa-on")'], ['id="act-load"', '$("#act-load")']]) {
    if (src.includes(ui)) assert.ok(src.includes(wire), `${ui} is rendered but ${wire} is never wired`);
  }
  assert.ok(/registerPasskey\(\)/.test(src.replace("async function registerPasskey()", "")), "registerPasskey is called");
});
