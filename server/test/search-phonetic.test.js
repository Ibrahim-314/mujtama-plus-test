const test = require("node:test"), assert = require("node:assert");
const P = require("../lib/search-phonetic");
test("sound key joins the two scripts for any loanword", () => {
  for (const [a, b] of [["بايثون", "python"], ["لابتوب", "laptop"], ["رياكت", "react"], ["جافاسكربت", "javascript"], ["كمبيوتر", "computer"]]) assert.equal(P.key(a), P.key(b), a + " ~ " + b);
  assert.notEqual(P.key("جده"), P.key("python"));
  assert.equal(P.script("python"), "lat"); assert.equal(P.script("بايثون"), "ar"); assert.equal(P.key("2026"), "");
});
