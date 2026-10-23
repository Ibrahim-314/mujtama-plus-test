/* Installable app (Phase 46). Public, read-only: what the installed PWA / store shell needs to know about this server.
 * GET /api/pwa/config → { push: { enabled, source: "env"|"stored"|"dev"|"none", note? }, shareTarget, release, minIos }
 * • push.enabled: VAPID keys from the environment (VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY), or the pair stored in notify_keys.
 *   Phase 52: the server generates and stores that pair on first start (production included) unless VAPID_ENV_ONLY=1;
 *   only then does a missing key mean enabled:false. "dev" = will be generated on first use. Keys are never returned here.
 * • release: dist/build.json release hash, so a store shell (Capacitor) can tell a web update is live. */
const fs = require("node:fs");
const path = require("node:path");
const { secret } = require("../lib/secrets");

module.exports = (ctx, opts = {}) => {
  const { db } = ctx;
  const R = ctx.router;
  const envOnly = () => require("../lib/providers").vapidPolicy() === "env-only"; // phase 52: auto-generated pair unless VAPID_ENV_ONLY=1
  let release = null;
  const releaseOf = () => {
    if (release !== null) return release;
    try { release = JSON.parse(fs.readFileSync(path.join(opts.webRoot || ctx.config?.webRoot || "dist", "build.json"), "utf8")).release || ""; } catch { release = ""; }
    return release;
  };
  async function pushState() {
    if (secret("VAPID_PUBLIC_KEY") && secret("VAPID_PRIVATE_KEY")) return { enabled: true, source: "env" };
    const row = await db.get("SELECT name FROM notify_keys WHERE name='vapid'").catch(() => null);
    if (row) return { enabled: true, source: "stored" };
    if (!envOnly()) return { enabled: true, source: "dev" };
    return { enabled: false, source: "none", note: "إشعارات الدفع غير مفعّلة على الخادم بعد (مفاتيح VAPID غير مضبوطة)" };
  }
  R.get("/api/pwa/config", async () => ({ push: await pushState(), shareTarget: "/share-target", release: releaseOf() || null, minIos: "16.4" }));
  return { pushState };
};
