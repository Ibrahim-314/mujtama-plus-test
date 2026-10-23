/* Performance budget (Phase 5): fails CI when the compressed bundle grows past its budget. */
import fs from "node:fs";
const BUDGET = { js: 90 * 1024, css: 16 * 1024, html: 4 * 1024 }; // brotli bytes (css 14→16 KB in v2.53: design-evolution layer — card/chip/tab tokens, Lucide sizing, empty-state art)
const b = JSON.parse(fs.readFileSync(new URL("../dist/build.json", import.meta.url)));
/* v2.70: the lazy «hls» chunk is the vendored hls.js light build (~98 KB br), fetched only when a video plays through
 * hls.js — never by the core bundle — so it has its own ceiling instead of the 90 KB per-chunk one. */
const FILE_BUDGET = [{ re: /^assets\/chunk-hls-/, br: 105 * 1024 }];
let fail = false;
for (const f of b.files) {
  const kind =
    f.file.endsWith(".js") && f.file.startsWith("assets")
      ? "js"
      : f.file.endsWith(".css") && f.file.startsWith("assets")
        ? "css"
        : f.file === "index.html"
          ? "html"
          : null;
  if (!kind) continue;
  const lim = (FILE_BUDGET.find((x) => x.re.test(f.file)) || {}).br || BUDGET[kind];
  const ok = f.br <= lim;
  fail ||= !ok;
  console.log(`${ok ? "✓" : "✗"} ${f.file.padEnd(30)} ${(f.br / 1024).toFixed(1)} KB / ${(lim / 1024).toFixed(0)} KB`);
}
process.exit(fail ? 1 : 0);
