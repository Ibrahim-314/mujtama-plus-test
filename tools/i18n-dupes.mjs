// Scans i18n-*.js catalogues for keys defined more than once anywhere in the file (main object + later Object.assign blocks).
// A later block silently overrides an earlier one, so duplicates are forbidden. Usage: node tools/i18n-dupes.mjs (exit 1 on dupes).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = /^\s*("(?:[^"\\]|\\.)*")\s*:/;
export function findDupes(src) {
  const seen = new Map(), dupes = [];
  src.split("\n").forEach((line, i) => {
    const m = KEY.exec(line);
    if (!m) return;
    const k = JSON.parse(m[1]);
    if (seen.has(k)) dupes.push({ key: k, first: seen.get(k), line: i + 1 });
    else seen.set(k, i + 1);
  });
  return dupes;
}
export function scanAll(dir = ROOT) {
  return fs.readdirSync(dir).filter((f) => /^i18n-(?!ui\.js$)[a-z]+\.js$/.test(f))
    .map((f) => ({ file: f, dupes: findDupes(fs.readFileSync(path.join(dir, f), "utf8")) }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bad = 0;
  for (const { file, dupes } of scanAll()) for (const d of dupes) { bad++; console.log(`${file}:${d.line} duplicate key ${JSON.stringify(d.key)} (first at ${d.first})`); }
  console.log(bad ? `${bad} duplicate i18n key(s)` : "i18n: no duplicate keys");
  process.exit(bad ? 1 : 0);
}
