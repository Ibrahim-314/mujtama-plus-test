/* Design lint (v2.32, phase D0; failing since v2.36, phase D5). Fails (exit 1) when any metric is worse than the recorded
 * baseline in tools/design-lint.baseline.json, so new one-off values can't creep back in; --warn prints only. Counts, across core CSS, lazy CSS chunks and client JS:
 *   raw hex colours outside :root/theme blocks · inline style="" attributes · distinct font-sizes · distinct border-radii ·
 *   distinct box-shadows · emoji used in UI source strings.
 * Compares with tools/design-lint.baseline.json (re-recorded at v2.36.0 after the D5 clean-up) and with the D5 targets.
 * When a metric improves, lower the baseline with --write-baseline so the gain is locked in.
 * Usage: node tools/design-lint.mjs [--json] [--warn] [--write-baseline] */
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const cssFiles = [...html.matchAll(/<link rel="stylesheet" href="((?:[\w-]+\/)*[\w.-]+\.css)"/g)].map(m => m[1]);
const jsFiles = [...html.matchAll(/<script src="((?:[\w-]+\/)*[\w.-]+\.js)"/g)].map(m => m[1]).filter(f => !/^i18n-en(plus|extra)?\.js$/.test(f));
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const stripTokens = css => css.replace(/(?:html)?:root[^{]*\{[^}]*\}/g, "").replace(/@media \(prefers-color-scheme: dark\) \{[^{]*\{[^}]*\} \}/g, "");
const cssOf = { core: cssFiles.filter(f => !/data-chunk/.test(html.split(f)[1].split(">")[0])).map(read).join("\n"), chunks: cssFiles.filter(f => /data-chunk/.test(html.split(f)[1].split(">")[0])).map(read).join("\n") };
/* CSS that lazy modules inject from JS (<style> text inside template strings) */
const jsSrc = Object.fromEntries(jsFiles.map(f => [f, read(f)]));
cssOf.injected = Object.values(jsSrc).map(s => (s.match(/[.#][\w-]+\s*\{[^{}`]*\}/g) || []).join("\n")).join("\n");
const distinct = (re, s) => new Set([...s.matchAll(re)].map(m => m[1].trim().replace(/\s*!important/, "")));
const all = stripTokens(cssOf.core) + "\n" + cssOf.chunks + "\n" + cssOf.injected;
const emojiRe = /\p{Extended_Pictographic}/gu;
const m = {
  hexCore: (stripTokens(cssOf.core).match(/#[0-9a-fA-F]{3,8}\b/g) || []).length,
  hexAll: (all.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length,
  inlineStyles: Object.values(jsSrc).reduce((n, s) => n + (s.match(/style="/g) || []).length, 0),
  fontSizesCore: distinct(/font-size:\s*([^;}]+)/g, cssOf.core).size,
  fontSizesAll: distinct(/font-size:\s*([^;}]+)/g, all).size,
  radiiCore: distinct(/border-radius:\s*([^;}]+)/g, cssOf.core).size,
  shadowsCore: distinct(/box-shadow:\s*([^;}]+)/g, cssOf.core).size,
  emojiInJs: Object.values(jsSrc).reduce((n, s) => n + (s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").match(emojiRe) || []).length, 0)
};
const TARGET = { hexCore: 0, fontSizesCore: 9, radiiCore: 5, shadowsCore: 4, emojiInJs: 0 };
const bf = path.join(ROOT, "tools", "design-lint.baseline.json");
if (process.argv.includes("--write-baseline")) fs.writeFileSync(bf, JSON.stringify(m, null, 2) + "\n");
const base = fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, "utf8")) : {};
if (process.argv.includes("--json")) { console.log(JSON.stringify(m)); process.exit(0); }
let worse = 0;
console.log("design-lint             metric            now   baseline  D5 target");
for (const [k, v] of Object.entries(m)) {
  const b = base[k], t = TARGET[k] ?? "—", w = b != null && v > b;
  worse += w;
  console.log(`${w ? "⚠" : "·"} ${k.padEnd(18)} ${String(v).padStart(6)} ${String(b ?? "—").padStart(9)} ${String(t).padStart(10)}`);
}
if (worse) console.log(`✗ ${worse} metric(s) got worse than the baseline: use tokens/components from gallery.html (u-* utilities, page head, chips, segments) instead of new one-off values.`);
else console.log("✓ design-lint: no metric worse than the baseline");
process.exit(worse && !process.argv.includes("--warn") ? 1 : 0);
