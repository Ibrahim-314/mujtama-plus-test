/* fix-i18n-comm: templated {name}/{t} keys, {p:one|other} plurals and Latin digits in LTR (i18n-ui.js lookup) */
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const R = path.join(__dirname, "..", "..");
function load() {
  global.window = global; global.DB = { settings: { lang: "en" } };
  global.document = { documentElement: { dataset: {} }, body: null, createElement: () => ({}), head: { appendChild() {} }, addEventListener() {}, querySelector: () => null };
  global.MutationObserver = class { observe() {} disconnect() {} };
  global.NodeFilter = {}; global.MPRoutes = { extend() {}, add() {} }; global.Remote = { on: false, api: () => Promise.resolve({}) }; global.addEventListener = () => {};
  for (const f of ["i18n-en.js"]) require(path.join(R, f));
  const st = global.setTimeout, si = global.setInterval; global.setTimeout = (...a) => st(...a).unref(); global.setInterval = (...a) => si(...a).unref();
  try { require(path.join(R, "i18n-ui.js")); } catch { /* boot code needs a real page; MPI18n is already set */ }
  global.setTimeout = st; global.setInterval = si;
  return global.MPI18n.t;
}
test("templated keys keep user text, translate UI fragments, plurals and digits", () => {
  const t = load();
  const en = [["اكتب في مجتمع التصميم…", "Write in مجتمع التصميم…"], ["الخطوة ١ من ٣", "Step 1 of 3"], ["1 صوت", "1 vote"], ["3 صوت", "3 votes"], ["0 مشاهدة", "0 views"],
    ["منشور من عضو نشيط", "Post by عضو نشيط"], ["انضم منذ 1 د", "Joined 1m ago"], ["انضم إلى مجتمع", "Join a community"], ["انضم كلام عشوائي", "انضم كلام عشوائي"],
    ["أُنشئ أكتوبر ٢٠٢٦", "Created October 2026"], ["نتائج «zz» داخل المجتمع", "Results for “zz” in this community"]];
  for (const [a, b] of en) assert.strictEqual(t(a), b, a);
  // v2.67: a retired fr / ur setting (old device or account) falls back to English, never to an empty catalogue
  for (const L of ["fr", "ur"]) { global.DB.settings.lang = L; assert.strictEqual(t("1 صوت"), "1 vote"); assert.strictEqual(t("2 مشاهدة"), "2 views"); assert.strictEqual(global.MPI18n.current(), "en"); }
  assert.deepEqual(Object.keys(global.MPI18n.languages), ["ar", "en"]);
  global.DB.settings.lang = "ar"; assert.strictEqual(t("اكتب في X…"), "اكتب في X…"); assert.strictEqual(t("الخطوة ١ من ٣"), "الخطوة ١ من ٣");
});
