/* Production build (Phase 1/5): esbuild minification of the classic-script client into one
 * content-hashed bundle, CSS bundle, precompressed .br/.gz, preload manifest, versioned SW.
 * Output: dist/ (served by the server with WEB_ROOT=dist). */
import { transform } from "esbuild";
import fsv from "node:fs";
const APP_VER = JSON.parse(fsv.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
  DIST = path.join(ROOT, "dist");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="((?:[\w-]+\/)*[\w.-]+\.js)"><\/script>/g)].map(m => m[1]);
/* code-split chunks: <script src="x.js" data-chunk="name"></script> load on demand (see chunks.js) */
/* v2.73: a chunk may span several files (video/clips/*.js): every tag with the same data-chunk is concatenated in index.html order */
const chunks = group([...html.matchAll(/<script src="((?:[\w-]+\/)*[\w.-]+\.js)" data-chunk="([\w-]+)"><\/script>/g)].map(m => ({ file: m[1], name: m[2] })));
const styles = [...html.matchAll(/<link rel="stylesheet" href="((?:[\w-]+\/)*[\w.-]+\.css)">/g)].map(m => m[1]);
/* lazy CSS chunks (v2.32): <link rel="stylesheet" href="x.css" data-chunk="name"> → assets/chunk-name-*.css, registered in
 * window.__CSS and fetched by chunks.js together with the JS chunk of the same name (or alone, for CSS-only chunks) */
const cssChunks = group([...html.matchAll(/<link rel="stylesheet" href="((?:[\w-]+\/)*[\w.-]+\.css)" data-chunk="([\w-]+)">/g)].map(m => ({ file: m[1], name: m[2] })));
function group(list) { const m = new Map(); for (const c of list) (m.get(c.name) || m.set(c.name, { name: c.name, files: [] }).get(c.name)).files.push(c.file); return [...m.values()]; }
const hash = s => crypto.createHash("sha256").update(s).digest("base64url").slice(0, 10);
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "assets"), { recursive: true });

/* sub-chunks (phase 47): <script src="x.js" data-chunk="name" data-parent="p"></script> — their URL is registered by the parent
 * chunk (prepended to its code), not by the core bundle, so a new lazy screen costs 0 bytes in core */
const subs = [...html.matchAll(/<script src="((?:[\w-]+\/)*[\w.-]+\.js)" data-chunk="([\w-]+)" data-parent="([\w-]+)"><\/script>/g)].map(m => ({ file: m[1], name: m[2], parent: m[3] }));
const subMap = {};
for (const c of subs) {
  const code = (await transform(fs.readFileSync(path.join(ROOT, c.file), "utf8").replaceAll("__APP_VERSION__", APP_VER), { loader: "js", minify: !process.env.NOMIN, target: "es2020", legalComments: "none", charset: "utf8" })).code;
  const name = `assets/chunk-${c.name}-${hash(code)}.js`; fs.writeFileSync(path.join(DIST, name), code); (subMap[c.parent] ||= {})[c.name] = "/" + name;
}
const chunkMap = {};
for (const c of chunks) {
  let code = (await transform(c.files.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n").replaceAll("__APP_VERSION__", APP_VER), { loader: "js", minify: !process.env.NOMIN, target: "es2020", legalComments: "none", charset: "utf8" })).code;
  if (subMap[c.name]) code = `Object.assign(window.__CHUNKS||(window.__CHUNKS={}),${JSON.stringify(subMap[c.name])});` + code;
  const name = `assets/chunk-${c.name}-${hash(code)}.js`; fs.writeFileSync(path.join(DIST, name), code); chunkMap[c.name] = "/" + name;
}
const cssMap = {};
for (const c of cssChunks) {
  const code = (await transform(c.files.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n"), { loader: "css", minify: true, target: ["chrome90", "safari15"], charset: "utf8" })).code;
  const name = `assets/chunk-${c.name}-${hash(code)}.css`; fs.writeFileSync(path.join(DIST, name), code); cssMap[c.name] = "/" + name;
}
const jsSrc = `window.__CHUNKS=${JSON.stringify(chunkMap)};window.__CSS=${JSON.stringify(cssMap)};\n` + scripts.map(f => `/* ${f} */\n` + fs.readFileSync(path.join(ROOT, f), "utf8").replaceAll("__APP_VERSION__", APP_VER)).join("\n;\n");
const js = (await transform(jsSrc, { loader: "js", minify: !process.env.NOMIN, target: "es2020", legalComments: "none", charset: "utf8" })).code;
const cssSrc = styles.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
const css = (await transform(cssSrc, { loader: "css", minify: true, target: ["chrome90", "safari15"], charset: "utf8" })).code;
const jsName = `assets/app-${hash(js)}.js`,
  cssName = `assets/app-${hash(css)}.css`;
fs.writeFileSync(path.join(DIST, jsName), js);
fs.writeFileSync(path.join(DIST, cssName), css);

let out = html.replace(/<link rel="stylesheet" href="(?:[\w-]+\/)*[\w.-]+\.css"( data-chunk="[\w-]+")?>\n?/g, "").replace(/<script src="(?:[\w-]+\/)*[\w.-]+\.js"( data-chunk="[\w-]+")?( data-parent="[\w-]+")?><\/script>\n?/g, "");
out = out.replace("</head>", `<link rel="stylesheet" href="/${cssName}">\n</head>`).replace("</body>", `<script src="/${jsName}" defer></script>\n</body>`);
// deferred bundle runs after parsing; keep the inline deferRoute flag ahead of it
fs.writeFileSync(path.join(DIST, "index.html"), out);
fs.writeFileSync(
  path.join(DIST, "preload.json"),
  JSON.stringify([
    { href: "/" + cssName, as: "style" },
    { href: "/" + jsName, as: "script" }
  ])
);
const release = hash(js + css);
fs.writeFileSync(
  path.join(DIST, "sw.js"),
  fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").replace(/const VERSION = "[^"]+"/, `const VERSION = "mp-${release}"`).replaceAll("__APP_VERSION__", APP_VER) /* v2.68: the SW also knows the human version number */
);
fs.cpSync(path.join(ROOT, "vendor"), path.join(DIST, "vendor"), { recursive: true, filter: (f) => !f.endsWith("hls.light.min.js") }); // v2.70: hls.js ships only as the hashed lazy «hls» chunk
/* public/: plain static files copied verbatim to the dist root (e.g. /pi-app-validation.txt for Pi App Studio).
 * Not compressed, not hashed, not rewritten; served as ordinary static files before the SPA fallback. */
const PUBLIC = path.join(ROOT, "public");
if (fs.existsSync(PUBLIC)) {
  fs.cpSync(PUBLIC, DIST, { recursive: true });
  const v = path.join(PUBLIC, "pi-app-validation.txt");
  if (fs.existsSync(v) && /\s$|^\s/.test(fs.readFileSync(v, "utf8"))) throw new Error("public/pi-app-validation.txt must have no leading/trailing whitespace or newline");
}
if (fs.existsSync(path.join(ROOT, "gallery.html"))) fs.copyFileSync(path.join(ROOT, "gallery.html"), path.join(DIST, "gallery.html"));
for (const f of ["theme.css", "ui.js", ...cssChunks.flatMap(c => c.files)]) { fs.mkdirSync(path.dirname(path.join(DIST, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f)); } // gallery uses the raw design tokens

const report = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html|json|svg)$/.test(f)) {
      const buf = fs.readFileSync(p);
      const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });
      const gz = zlib.gzipSync(buf, { level: 9 });
      fs.writeFileSync(p + ".br", br);
      fs.writeFileSync(p + ".gz", gz);
      report.push({ file: path.relative(DIST, p), raw: buf.length, br: br.length, gz: gz.length });
    }
  }
})(DIST);
fs.writeFileSync(path.join(DIST, "build.json"), JSON.stringify({ release, builtAt: new Date().toISOString(), files: report }, null, 2));
const kb = n => (n / 1024).toFixed(1) + " KB";
console.log(`✓ build ${release}`);
for (const r of report.filter(r => /assets|index/.test(r.file))) console.log(`  ${r.file.padEnd(32)} ${kb(r.raw).padStart(9)}  br ${kb(r.br).padStart(8)}`);
