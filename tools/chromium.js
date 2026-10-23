/* Resolves a working Chromium for E2E tests and screenshots.
 * Order: CHROMIUM_PATH -> persistent copy in /workspace/.cache (survives sandbox resets) -> system paths.
 * If none works, runs tools/setup-chromium.sh once to rebuild the persistent copy. */
const fs = require("node:fs"),
  path = require("node:path"),
  { execSync, spawnSync } = require("node:child_process");
const CACHE = process.env.MP_BROWSER_CACHE || "/workspace/.cache";
const LIBS = path.join(CACHE, "chromium-libs");
function persistent() {
  const base = path.join(CACHE, "ms-playwright");
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base).filter(n => n.startsWith("chromium-")).sort().reverse()) {
    const p = path.join(base, d, "chrome-linux", "chrome");
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function env() {
  const e = { ...process.env };
  if (fs.existsSync(LIBS)) e.LD_LIBRARY_PATH = [LIBS, e.LD_LIBRARY_PATH].filter(Boolean).join(":");
  return e;
}
function works(p) {
  if (!p || !fs.existsSync(p)) return false;
  const r = spawnSync(p, ["--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", "data:text/html,<p>ok</p>"], { env: env(), timeout: 40000, encoding: "utf8" });
  return r.status === 0 && /ok/.test(r.stdout || "");
}
let cached;
function resolveChromium() {
  if (cached) return cached;
  const candidates = [process.env.CHROMIUM_PATH, persistent(), "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
  let found = candidates.find(works);
  if (!found) {
    execSync("bash " + path.join(__dirname, "setup-chromium.sh"), { stdio: "inherit", env: { ...process.env, MP_BROWSER_CACHE: CACHE } });
    found = persistent();
    if (!works(found)) throw new Error("Chromium unavailable even after tools/setup-chromium.sh — see its output");
  }
  cached = { executablePath: found, env: env() };
  return cached;
}
module.exports = { resolveChromium };
if (require.main === module) console.log(resolveChromium().executablePath);
