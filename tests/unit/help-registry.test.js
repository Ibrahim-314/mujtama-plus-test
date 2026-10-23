/* v2.61 page help: route matching, language fallback and the registry's own shape (help-ui.js + help-content.js). */
const test = require("node:test"), assert = require("node:assert");
const path = require("node:path");
const { match, norm, lines, pick, sectionOf, merge } = require(path.join(__dirname, "..", "..", "help-ui.js"));

const L = [
  { route: "#/c/:id", title: { ar: "مجتمع" } },
  { route: "#/c/:id/wiki", title: { ar: "ويكي" } },
  { route: "#/receipt/", title: { ar: "إيصال" } },
  { route: "#/admin/*", title: { ar: "إدارة" } },
  { route: "#/admin/market", title: { ar: "سوق" } },
  { route: "#/home", aliases: ["#/feed"], title: { ar: "الرئيسية" } }
];
const t = (h) => match(h, L)?.title.ar ?? null;

test("normalises hashes", () => {
  assert.equal(norm(""), "#/home"); assert.equal(norm("#/"), "#/home"); assert.equal(norm("#/c/1?tab=x"), "#/c/1"); assert.equal(norm("#/studio/"), "#/studio");
});
test("exact, params, prefix, wildcard, aliases, specificity", () => {
  assert.equal(t("#/home"), "الرئيسية"); assert.equal(t(""), "الرئيسية"); assert.equal(t("#/feed"), "الرئيسية");
  assert.equal(t("#/c/42"), "مجتمع"); assert.equal(t("#/c/42?x=1"), "مجتمع"); assert.equal(t("#/c/42/wiki"), "ويكي");
  assert.equal(t("#/c"), null, "a param needs its segment");
  assert.equal(t("#/receipt"), "إيصال"); assert.equal(t("#/receipt/abc"), "إيصال");
  assert.equal(t("#/admin/market"), "سوق", "literal beats wildcard"); assert.equal(t("#/admin/pricing"), "إدارة"); assert.equal(t("#/admin"), null);
  assert.equal(t("#/studio"), null, "no entry → no icon"); assert.equal(t("#/homex"), null);
});
test("language fallback to Arabic and body lines", () => {
  assert.deepEqual(pick({ ar: "أ", en: "A" }, "en"), { v: "A", lang: "en" });
  assert.deepEqual(pick({ ar: "أ" }, "en"), { v: "أ", lang: "ar" });
  assert.deepEqual(pick({ ar: ["١"], en: [] }, "en"), { v: ["١"], lang: "ar" });
  assert.deepEqual(lines("a\n b \n\nc"), ["a", "b", "c"]); assert.deepEqual(lines(["x", " "]), ["x"]);
});
test("sections: the section on screen picks among same-route entries, most specific wins", () => {
  const S = [
    { route: "#/cadmin/:id", section: "home", title: { ar: "لوحة" } },
    { route: "#/cadmin/:id", section: "automod", title: { ar: "آلي" } },
    { route: "#/cadmin", title: { ar: "مجتمعاتي" } },
    { route: "#/studio", title: { ar: "استوديو" } },
    { route: "#/studio?tab=calendar", title: { ar: "تقويم" } },
    { route: "#/studio", section: "best", title: { ar: "أفضل وقت" } },
    { route: "#/c/:id", section: "posts", title: { ar: "منشورات" } },
    { route: "#/c/:id", section: "channels", title: { ar: "قنوات" } },
    { route: "#/c/:id/knowledge", title: { ar: "معرفة" } }
  ];
  const at = (h, st) => match(h, S, sectionOf(h, st))?.title.ar ?? null;
  assert.equal(sectionOf("#/cadmin/7?s=automod"), "automod"); assert.equal(sectionOf("#/cadmin/7"), "home");
  assert.equal(at("#/cadmin/7?s=automod"), "آلي"); assert.equal(at("#/cadmin/7"), "لوحة"); assert.equal(at("#/cadmin"), "مجتمعاتي");
  assert.equal(at("#/cadmin/7?s=unknown"), "لوحة", "unknown section still gets the page's help");
  assert.equal(at("#/studio"), "استوديو", "no tab picked → page-wide entry");
  assert.equal(at("#/studio", { _stab: "calendar" }), "تقويم", "?tab= written on the route works as a section");
  assert.equal(at("#/studio", { _stab: "best" }), "أفضل وقت"); assert.equal(at("#/studio", { _stab: "weekly" }), "استوديو", "fallback to #/studio");
  assert.equal(at("#/c/3"), "منشورات"); assert.equal(at("#/c/3", { _ctab: "posts", _cch: { 3: "ch1" } }), "قنوات");
  assert.equal(at("#/c/3", { _ctab: "posts", _cch: { 9: "x" } }), "منشورات", "a channel open in another community does not count");
  assert.equal(at("#/c/3/knowledge", { _ctab: "knowledge" }), "معرفة", "literal sub-route beats the section entries");
});
test("language files merge into the Arabic registry by route|section", () => {
  const S = [{ route: "#/a", title: { ar: "أ" }, body: { ar: "١\n٢" } }, { route: "#/a", section: "x", title: { ar: "س" } }];
  merge(S, "en", { "#/a|": { title: "A", body: "1\n2", tips: ["t"] }, "#/a|x": { title: "X" } });
  assert.deepEqual(S[0].title, { ar: "أ", en: "A" }); assert.deepEqual(S[0].tips, { en: ["t"] }); assert.equal(S[1].title.en, "X");
});

function loadAll() {
  global.window = {};
  for (const f of ["help-content.js", "help-content-en.js"]) { const p = path.join(__dirname, "..", "..", f); delete require.cache[p]; require(p); }
  const R = global.window.MPHelpContent, Lm = global.window.MPHelpContentL; delete global.window;
  for (const L of ["en"]) merge(R, L, Lm[L]);
  return { R, Lm };
}
test("registry entries follow the documented shape", () => {
  const { R, Lm } = loadAll();
  assert.ok(Array.isArray(R) && R.length >= 200, "merged registry (" + R.length + ")");
  for (const k of ["#/home", "#/feedprefs", "#/studio", "#/wallet", "#/mjt", "#/communities", "#/c/1", "#/cadmin/1", "#/legal", "#/transparency/2026-09"]) assert.ok(match(k, R), k);
  const seen = new Set(), keys = new Set(R.map((e) => e.route + "|" + (e.section || "")));
  for (const e of R) {
    const k = e.route + "|" + (e.section || "");
    assert.match(e.route, /^#\/[^?]*$/, "route has no query (sections use `section`): " + e.route); assert.ok(!seen.has(k), "duplicate " + k); seen.add(k);
    assert.ok(e.title.ar && e.body.ar, k + " needs ar");
    for (const L of ["en"]) assert.ok(e.title[L] && e.body[L], `${k} has ${L}`);
    for (const L of ["fr", "ur"]) assert.ok(!e.title[L] && !e.body[L], `${k} carries no retired ${L} text (v2.67: ar + en only)`);
    for (const lang of Object.keys(e.body)) { const n = lines(e.body[lang]).length; assert.ok(n >= 2 && n <= 4, `${k} ${lang} body 2–4 lines (${n})`); }
    for (const lang of Object.keys(e.tips || {})) assert.ok(e.tips[lang].length <= 3, `${k} ${lang} ≤3 tips`);
    for (const a of e.aliases || []) assert.match(a, /^#\//);
    assert.doesNotMatch(JSON.stringify(e), /<[a-z/]/i, "plain text only");
  }
  assert.deepEqual(Object.keys(Lm), ["en"], "only the en help chunk exists (v2.67)");
  for (const L of ["en"]) for (const k of Object.keys(Lm[L])) assert.ok(keys.has(k), `${L} key ${k} has an Arabic entry`);
  // no two entries answer the same hash+section with equal specificity (the merge kept one per route|section)
  assert.equal(seen.size, R.length);
});
test("every router route resolves to an entry (tools/help-coverage.mjs)", () => {
  const out = JSON.parse(require("node:child_process").execFileSync(process.execPath, [path.join(__dirname, "..", "..", "tools", "help-coverage.mjs"), "--json"], { encoding: "utf8" }));
  assert.ok(out.routes > 150, "found the router (" + out.routes + ")");
  assert.deepEqual(out.missing, []); assert.deepEqual(out.sectionMissing, []);
});
