#!/usr/bin/env node
/* v2.69 — English coverage guard.
 * Scans the app's front-end JS for Arabic UI strings (string literals, template text, HTML text)
 * and checks each one has an English entry in i18n-en.js / i18n-enplus.js.
 * Strings already missing when the guard was introduced live in tools/i18n-coverage.baseline.json;
 * any NEW untranslated Arabic UI string fails the check, so the English UI cannot regress.
 *   node tools/i18n-coverage.mjs            -> check (exit 1 on new missing strings)
 *   node tools/i18n-coverage.mjs --update   -> rewrite the baseline (only shrink it in practice)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "tools/i18n-coverage.baseline.json");
const CATALOGS = ["i18n-en.js", "i18n-enplus.js", "i18n-enextra.js"];
const SKIP = (f) => f.startsWith("i18n") || f.startsWith("help-content") || f === "sw.js" || f === "store.js";

const AR = /[\u0600-\u06FF]/;
const NUM = /[0-9٠-٩۰-۹]+(?:[.,٫][0-9٠-٩۰-۹]+)?/g;
const CODE = /\$\{|=>|;|\|\||\?\.|\]\)|\bconst\b|\breturn\b|\w\(/;
const KEY_RE = /^\s*"((?:[^"\\]|\\.)*)"\s*:/gm;

export function loadKeys() {
  const keys = new Set();
  for (const f of CATALOGS) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, "utf8").matchAll(KEY_RE)) keys.add(JSON.parse(`"${m[1]}"`));
  }
  return keys;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HOLE = /\$\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g;
const LIT = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

export function pieces(src, depth = 0) {
  const out = [];
  for (const m of src.matchAll(LIT)) {
    let t = m[1] ?? m[2] ?? m[3];
    if (!AR.test(t)) continue;
    t = t.replace(HOLE, (e) => {
      if (/^\$\{\s*(?:esc\()?\s*(?:t|tr|T|_t|MPI18n\.t)\(/.test(e)) return "\x00";
      if (/(n|count|num|len|length|total|size|cnt|fmt|Num|toLocale|pct|days|hours|mins|sec|score|price|amount|bal)\b/i.test(e)) return "{n}";
      return "{name}";
    });
    t = t.replace(/<[^>]*>/g, "\x00");
    for (let p of t.split("\x00")) {
      p = p.replace(/\s+/g, " ").trim();
      if (/^(\{name\}|\{n\}|\s)+$/.test(p)) continue;
      if (CODE.test(p)) { if (depth < 3) out.push(...pieces(p, depth + 1)); continue; }
      if (AR.test(p) && p.length <= 200) out.push(p);
    }
  }
  return out;
}

export function missing() {
  const keys = loadKeys();
  const nk = new Set([...keys].map((k) => k.replace(NUM, "{n}")));
  const miss = new Map();
  const files = [...fs.readdirSync(ROOT), ...fs.readdirSync(path.join(ROOT, "video"), { recursive: true }).map((f) => path.join("video", f))].filter((f) => f.endsWith(".js") && !SKIP(f)).sort();
  for (const f of files) {
    for (const p of pieces(stripComments(fs.readFileSync(path.join(ROOT, f), "utf8")))) {
      if (keys.has(p) || nk.has(p.replace(NUM, "{n}"))) continue;
      if (!miss.has(p)) miss.set(p, f);
    }
  }
  return miss;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const miss = missing();
  if (process.argv.includes("--update")) {
    fs.writeFileSync(BASELINE, JSON.stringify([...miss.keys()].sort(), null, 0).replace(/","/g, '",\n"') + "\n");
    console.log(`i18n-coverage: baseline written (${miss.size} known gaps)`);
    process.exit(0);
  }
  const base = new Set(fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : []);
  const fresh = [...miss].filter(([p]) => !base.has(p));
  if (fresh.length) {
    console.error(`i18n-coverage: ${fresh.length} Arabic UI string(s) have no English translation:`);
    for (const [p, f] of fresh.slice(0, 50)) console.error(`  ${f}: ${p}`);
    console.error("Add them to i18n-enplus.js (or i18n-en.js).");
    process.exit(1);
  }
  console.log(`i18n-coverage: OK — no new untranslated strings (${miss.size} known gaps in baseline)`);
}
