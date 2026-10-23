/* v2.61 help-wire: every route the router knows must resolve to a page-help entry.
 * Routes = app.js route() core table + every MPRoutes.extend layer's keys + every MPRoutes.add(name) with the
 * sub-routes it claims (a === "x" / case "x") + chunks.js ROUTES. Each route is tried as "#/r" and "#/r/x1" (a param);
 * covered if either resolves. Prints the missing list; exit 1 when something is missing that is not a known redirect.
 * Usage: node tools/help-coverage.mjs [--json] */
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), ".."), req = createRequire(import.meta.url);
const { match } = req(path.join(ROOT, "help-ui.js"));
globalThis.window = {}; req(path.join(ROOT, "help-content.js")); const R = globalThis.window.MPHelpContent;
const files = [...fs.readdirSync(ROOT), ...fs.readdirSync(path.join(ROOT, "video"), { recursive: true }).map((f) => path.join("video", f))].filter((f) => f.endsWith(".js") && !f.startsWith("help-") && !f.startsWith("i18n-") && !["sw.js", "registry.js"].includes(f));
const routes = new Map(); const add = (r, f) => { r = r.replace(/^\/+|\/+$/g, ""); if (r && /^[\w-]+(\/[\w-]+)*$/.test(r)) (routes.get(r) || routes.set(r, new Set()).get(r)).add(f); };
/** the text of a call starting at `i` (index of "("), bracket-balanced, skipping strings/templates/comments roughly */
function callText(s, i) {
  let d = 0, q = null;
  for (let j = i; j < s.length && j < i + 60000; j++) {
    const c = s[j];
    if (q) { if (c === "\\") { j++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "/" && s[j + 1] === "/") { j = s.indexOf("\n", j); if (j < 0) break; continue; }
    if (c === "(" || c === "{" || c === "[") d++; else if (c === ")" || c === "}" || c === "]") { d--; if (!d) return s.slice(i, j + 1); }
  }
  return s.slice(i, i + 4000);
}
const keyRe = /(?:^|[{,(]\s*|\.\.\.[^,]*?,\s*)["']?([a-z][\w-]*)["']?\s*:\s*(?:async\s*)?(?:\([^()]*\)|[a-z_]\w*)\s*=>/gi;
for (const f of files) {
  const s = fs.readFileSync(path.join(ROOT, f), "utf8");
  if (f === "app.js") { const m = /function route\(\)[\s\S]*?\(\{([\s\S]*?)\}\[r\]/.exec(s); if (m) for (const k of m[1].matchAll(keyRe)) add(k[1], f); }
  for (const m of s.matchAll(/MPRoutes\.extend\(/g)) {
    const t = callText(s, m.index + "MPRoutes.extend".length);
    // only the object literal(s) the layer returns: keys followed by an arrow that renders
    for (const k of t.matchAll(keyRe)) add(k[1], f);
  }
  for (const m of s.matchAll(/MPRoutes\.add\(\s*["']([\w-]+)["']/g)) {
    const t = callText(s, m.index + "MPRoutes.add".length); const subs = [...t.matchAll(/\ba\s*===\s*["']([\w-]+)["']|case\s+["']([\w-]+)["']|\[\s*((?:["'][\w-]+["']\s*,?\s*)+)\]\.includes\(a\)/g)];
    let any = false;
    for (const x of subs) { const names = x[3] ? [...x[3].matchAll(/["']([\w-]+)["']/g)].map((y) => y[1]) : [x[1] || x[2]]; for (const n of names) { add(m[1] + "/" + n, f); any = true; } }
    if (!any) add(m[1], f);
  }
  if (f === "chunks.js") for (const m of s.matchAll(/ROUTES(?:\.(\w+)\s*=|\s*=\s*\{)([\s\S]*?)(?:;|\n)/g)) for (const a of m[2].matchAll(/["']([\w/-]+)["']/g)) add(a[1], f);
}
// keys that are layer plumbing, not routes (object keys inside handlers that happen to look like arrows)
const NOT_ROUTES = new Set(["onclick", "then", "catch", "onload", "onerror", "default"]);
// internal redirects: the route only forwards to another screen (which has its own entry)
const REDIRECTS = { cmod: "#/cadmin/:id?s=moderation", cset: "#/cadmin/:id?s=general", chealth: "#/cadmin/:id?s=health" };
const covered = (r) => !!(match("#/" + r, R) || match("#/" + r + "/x1", R) || match("#/" + r + "/x1/x2", R));
const missing = [...routes.keys()].filter((r) => !NOT_ROUTES.has(r) && !REDIRECTS[r] && !covered(r)).sort();
// inner sections: every cadmin ?s=, studio tab and community tab has its own entry (or the page-wide one)
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8"), keysIn = (t) => [...t.matchAll(/\bk: "([\w-]+)"/g)].map((m) => m[1]);
const secs = { "#/cadmin/:id": keysIn(/const SECTIONS = \[([\s\S]*?)\n {2}\];/.exec(src("cadmin-ui.js"))?.[1] || ""),
  "#/studio": [.../const TABS = \[(.*?)\];/.exec(src("creation-ui.js"))?.[1].matchAll(/\["([\w-]+)"/g) || []].map((m) => m[1]) };
const secMissing = [];
for (const [route, ks] of Object.entries(secs)) for (const k of ks) { const e = R.find((x) => x.route === route && (x.section || "") === k); if (!e) secMissing.push(route + " §" + k); }
if (secMissing.length) missing.push(...secMissing);
const out = { sections: Object.fromEntries(Object.entries(secs).map(([r, ks]) => [r, ks.length])), sectionMissing: secMissing, redirects: Object.keys(REDIRECTS).filter((r) => routes.has(r)).map((r) => "#/" + r + " → " + REDIRECTS[r]), routes: routes.size, entries: R.length, covered: routes.size - missing.filter((r) => routes.has(r)).length, missing: missing.filter((r) => routes.has(r)).map((r) => ({ route: "#/" + r, from: [...routes.get(r)] })) };
if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 1));
else { console.log(`help coverage: ${out.covered}/${out.routes} router routes resolve to an entry (${out.entries} entries)`); console.log("  sections with their own entry:", JSON.stringify(out.sections), out.sectionMissing.length ? "missing " + out.sectionMissing.join(", ") : "— all"); for (const r of out.redirects) console.log("  redirect", r); for (const m of out.missing) console.log("  missing", m.route, "←", m.from.join(",")); }
process.exitCode = missing.length ? 1 : 0;
