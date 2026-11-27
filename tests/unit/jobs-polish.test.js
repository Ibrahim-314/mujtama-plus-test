/* v2.149.16 — jobs page polish: no stray list bullets, phone header actions wrap, pay range stays in reading order, one English name. */
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs"); const path = require("node:path");
const R = (f) => fs.readFileSync(path.join(__dirname, "../..", f), "utf8");
test("work.css resets list bullets inside work pages", () => { assert.match(R("work.css"), /\.wk-page ul\.list[^{]*\{[^}]*list-style:none/); });
test("work.css wraps page-head actions on phones instead of scrolling them off-screen", () => { assert.match(R("work.css"), /@media \(max-width:599px\)\{\.wk-page \.page-head \.acts\{flex-wrap:wrap;overflow-x:visible/); });
test("pay text is wrapped in LRI…PDI so «300–500 π» is not mirrored in RTL", () => { const s = R("work-ui.js"); assert.match(s, /const payAmt = [^\n]*\\u2066[^\n]*π\\u2069/); }); // v2.167: the admin review list (payTxt) was removed; members see pay through payAmt
test("standalone «العمل الحر» translates to Freelance, not Work", () => { const s = R("i18n-enplus.js"); assert.match(s, /"العمل الحر": "Freelance"/); assert.doesNotMatch(s, /"العمل الحر": "Work"/); });
