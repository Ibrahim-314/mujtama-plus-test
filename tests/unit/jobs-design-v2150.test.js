/* v2.150.0 — jobs page design (user-approved mockup 2026-11-20): nothing removed, only reorganised. */
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs"); const path = require("node:path");
const R = (f) => fs.readFileSync(path.join(__dirname, "../..", f), "utf8");
const W = R("work-ui.js"), C = R("work.css");
test("header keeps contracts, teams and talent as tiles (moved, not removed) and one add button", () => {
  assert.match(W, /class="wk-qk"/); for (const href of ["#/contracts", "#/teams", "#/talent"]) assert.ok(W.includes(`["${href}"`), href);
  assert.match(W, /class="btn sm wk-add" href="#\/jobs\/new"/);
});
test("job card: kind pill, «جديد», relative time, pay pill, 3 skills + «+N», deadline countdown, save button outside the link", () => {
  for (const k of ["wk-kp", "wk-new", "wk-ago", "wk-ttl", "wk-cf", "wk-dlp", "data-jsave"]) assert.ok(W.includes(k), k);
  assert.match(W, /j\.skills\.slice\(0, 3\)/); assert.match(W, /<\/a>\$\{saveBtn\(j\)\}<\/li>/);
  assert.match(W, /Intl\.RelativeTimeFormat/);
});
test("chips show per-kind counts from the server", () => { assert.match(W, /d\.kindCounts/); assert.match(R("server/services/jobs.js"), /kindCounts\[j\.kind\]/); });
test("job view: gradient hero with pay, icon facts, sticky apply bar, owner grid, boost card kept with «غير مفعّل بعد»", () => {
  for (const k of ["wk-jhero", "wk-hpay", "wk-fic", "wk-bar", "wk-own", "wk-soon", "data-boost", "d.piNotice"]) assert.ok(W.includes(k), k);
  assert.match(C, /\.wk-bar\{position:sticky/);
});
test("mine: activity stats and an application progress bar; lists keep .list a.li", () => {
  for (const k of ["wk-stats", "wk-prog", 'class="list card wk-ml"']) assert.ok(W.includes(k), k);
});
test("new strings have English", () => { const e = R("i18n-enextra.js"); for (const k of ["ينتهي اليوم", "باقي {n} أيام", "حفظ الفرصة", "إدارة الإعلان", "{n} متقدّم"]) assert.ok(e.includes(`"${k}":`), k); });
