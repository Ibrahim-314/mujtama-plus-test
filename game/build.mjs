/* Builds «المدينة الرقمية» from game/src into game/ (served at /game/…):
 *   game/game.js         the entry module (three.js + engine, minified ESM)
 *   game/chunks/*.js     one chunk per scene (loaded when the player goes there) + shared code
 *   game/game.css        the game's interface
 * Assets (game/assets: characters, furniture, fonts) are used as they are. tools/build.mjs copies all of it to dist/game.
 * Run: node game/build.mjs   (add --watch while designing) */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
fs.rmSync(path.join(DIR, "chunks"), { recursive: true, force: true });

const js = {
  entryPoints: { game: path.join(DIR, "src/main.js") },
  outdir: DIR, bundle: true, splitting: true, format: "esm", minify: true, target: ["es2020"], legalComments: "eof",
  chunkNames: "chunks/[name]-[hash]", sourcemap: false, logLevel: "info"
};
const css = { entryPoints: [path.join(DIR, "src/ui/game.css")], outfile: path.join(DIR, "game.css"), bundle: true, minify: true, external: ["/game/*"], logLevel: "info" };

if (watch) { (await esbuild.context(js)).watch(); (await esbuild.context(css)).watch(); }
else {
  await Promise.all([esbuild.build(js), esbuild.build(css)]);
  const sz = (f) => (fs.statSync(path.join(DIR, f)).size / 1024).toFixed(1) + " KB";
  console.log("game.js", sz("game.js"), "· game.css", sz("game.css"), "· chunks", fs.readdirSync(path.join(DIR, "chunks")).length);
}
