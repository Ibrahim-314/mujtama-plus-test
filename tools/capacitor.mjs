/* Phase 46: Capacitor shell for the app stores (Google Play / App Store). No native build runs here and no accounts are needed.
 *   node tools/capacitor.mjs config            → (re)write capacitor.config.json from env
 *   node tools/capacitor.mjs sync|android|ios  → build the web app, then `npx cap sync|open <platform>` IF @capacitor/cli is installed
 * Env: CAP_APP_ID (plus.mujtama.app) · CAP_APP_NAME (مجتمع بلس) · CAP_SERVER_URL (https://… : the shell loads the live site, so the UI
 * updates without a store release — sw.js handles versioning; unset → the bundled dist/ is used) · CAP_ALLOW_NAV (extra hosts, space-separated).
 * Native setup (once, on a developer machine): npm i -D @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios
 *   && npx cap add android && npx cap add ios ; icons/splash: npx @capacitor/assets generate --assetPath public/icons
 * Push inside the store app needs @capacitor/push-notifications + FCM/APNs credentials (not part of this repo). */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
export function config(env = process.env) {
  const url = env.CAP_SERVER_URL && /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(env.CAP_SERVER_URL) ? env.CAP_SERVER_URL.replace(/\/$/, "") : null;
  const hosts = ["*.minepi.com", "sdk.minepi.com", ...String(env.CAP_ALLOW_NAV || "").split(/\s+/).filter(Boolean)];
  return {
    appId: env.CAP_APP_ID || "plus.mujtama.app",
    appName: env.CAP_APP_NAME || "مجتمع بلس",
    webDir: "dist",
    backgroundColor: "#faf8ff",
    ...(url ? { server: { url, cleartext: false, allowNavigation: [new URL(url).host, ...hosts] } } : { server: { androidScheme: "https", allowNavigation: hosts } }),
    android: { allowMixedContent: false, backgroundColor: "#faf8ff" },
    ios: { contentInset: "automatic", backgroundColor: "#faf8ff", limitsNavigationsToAppBoundDomains: false },
    plugins: { SplashScreen: { launchShowDuration: 600, backgroundColor: "#faf8ff", showSpinner: false } }
  };
}
const write = () => { const c = config(); fs.writeFileSync(path.join(ROOT, "capacitor.config.json"), JSON.stringify(c, null, 2) + "\n"); return c; };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const cmd = process.argv[2] || "config";
  const c = write();
  console.log(`✓ capacitor.config.json (${c.appId}${c.server.url ? ", live: " + c.server.url : ", bundled dist/"})`);
  if (cmd !== "config") {
    if (!fs.existsSync(path.join(ROOT, "node_modules", "@capacitor", "cli"))) {
      console.log("ℹ @capacitor/cli is not installed — native builds are optional. See the header of tools/capacitor.mjs for the one-time setup.");
      process.exit(0);
    }
    execSync("node tools/build.mjs", { cwd: ROOT, stdio: "inherit" });
    execSync(cmd === "sync" ? "npx cap sync" : `npx cap sync ${cmd} && npx cap open ${cmd}`, { cwd: ROOT, stdio: "inherit" });
  }
}
