/* Phase 46 — installable app. SQLite by default, PostgreSQL with TEST_DATABASE_URL.
 * Covers: GET /api/pwa/config (dev keeps generate-once keys; VAPID_ENV_ONLY=1 / production never generates: push disabled with a clear
 * Arabic note, /api/push/vapid 503 push_not_configured, notify settings still render; env keys → enabled "env", key served),
 * manifest (installable fields, every icon file exists with its declared PNG size, maskable + share_target), the service worker
 * (versioned, update waits for "mp-skip-waiting", drafts queue + share target handlers), Capacitor config (https-only live URL). */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { boot } = require("./helpers");
const WP = require("../lib/webpush");
const ROOT = path.join(__dirname, "..", "..");
const ENV = ["VAPID_ENV_ONLY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const restore = () => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
const pngSize = (f) => { const b = fs.readFileSync(f); assert.equal(b.toString("ascii", 1, 4), "PNG", f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("push availability: dev generates once, env-only disables without keys, env keys enable", async () => {
  for (const k of ENV) delete process.env[k];
  try {
    let H = await boot();
    try {
      const c = await new H.Client().req("GET", "/api/pwa/config");
      assert.equal(c.status, 200); assert.equal(c.push.enabled, true); assert.ok(["dev", "stored"].includes(c.push.source), c.push.source); /* since v2.25 activation warms a generate-once pair at boot: "stored" */ assert.equal(c.shareTarget, "/share-target");
      assert.equal(c.publicKey, undefined); assert.ok(!JSON.stringify(c).includes("privateKey"));
    } finally { await H.app.close(); }

    process.env.VAPID_ENV_ONLY = "1";
    H = await boot();
    try {
      const U = new H.Client();
      const c = await U.req("GET", "/api/pwa/config");
      assert.equal(c.push.enabled, false); assert.equal(c.push.source, "none"); assert.match(c.push.note, /VAPID/);
      const v = await U.req("GET", "/api/push/vapid");
      assert.equal(v.status, 503); assert.equal(v.code, "push_not_configured"); assert.match(v.error, /غير مفعّلة/);
      assert.equal((await U.req("POST", "/api/auth/register", { name: "عضو", handle: "pwa_u1", password: "secret123" })).status, 200);
      const s = await U.req("GET", "/api/notify/settings");
      assert.equal(s.status, 200, s.error); assert.equal(s.push.publicKey, null);
      const keys = await H.app.ctx?.db?.get?.("SELECT COUNT(*) n FROM notify_keys").catch(() => null);
      if (keys) assert.equal(Number(keys.n), 0, "no key pair generated");
    } finally { await H.app.close(); }

    const k = WP.generateVapidKeys(); // runtime-only test pair, never written anywhere
    process.env.VAPID_PUBLIC_KEY = k.publicKey; process.env.VAPID_PRIVATE_KEY = k.privateKey;
    H = await boot();
    try {
      const c = await new H.Client().req("GET", "/api/pwa/config");
      assert.equal(c.push.enabled, true); assert.equal(c.push.source, "env");
      assert.equal((await new H.Client().req("GET", "/api/push/vapid")).publicKey, k.publicKey);
    } finally { await H.app.close(); }
  } finally { restore(); }
});

test("manifest: installable, all icons exist at their sizes, maskable, share target", () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "manifest.json"), "utf8"));
  for (const k of ["name", "short_name", "start_url", "scope", "display", "theme_color", "background_color", "id"]) assert.ok(m[k], k);
  assert.equal(m.dir, "rtl"); assert.equal(m.lang, "ar"); assert.ok(m.start_url.startsWith(m.scope));
  const sizes = m.icons.filter((i) => i.purpose === "any").map((i) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(m.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
  for (const i of [...m.icons, ...m.shortcuts.flatMap((s) => s.icons)]) {
    const [w, h] = pngSize(path.join(ROOT, "public", i.src));
    assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
  assert.deepEqual(pngSize(path.join(ROOT, "public", "icons", "apple-touch-icon-180.png")), [180, 180]);
  assert.equal(fs.readdirSync(path.join(ROOT, "public", "icons")).filter((f) => f.startsWith("splash-")).length, 15);
  assert.equal(m.share_target.action, "/share-target"); assert.equal(m.share_target.method, "POST");
  assert.equal(m.share_target.params.files[0].name, "media");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(html, /<link rel="manifest" href="\/manifest.json">/);
  assert.match(html, /data-chunk="pwa"/);
  assert.match(fs.readFileSync(path.join(ROOT, "notify-ui.js"), "utf8"), /MPChunks\?\.load\("pwa"\)/, "loaded by the lazy notify chunk (0 B core)");
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "pwa-ui.js"), "utf8"), /\son[a-z]+=\s*["']/, "no inline handlers (CSP)");
});

test("service worker: versioned, update waits for the page, drafts queue + share target", async () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.match(sw, /const VERSION = "[^"]+"/);
  assert.match(sw, /if \(!self\.registration\.active\) return self\.skipWaiting\(\)/);
  assert.match(sw, /"mp-skip-waiting"/);
  for (const s of ["/share-target", "mp-drafts", "draftWrite", "draftList", "/api/auth/logout", "Response.redirect(\"/?source=share#/home\", 303)"]) assert.ok(sw.includes(s), s);
  const READ = new RegExp(/const READ = (\/.+\/);/.exec(sw)[1].slice(1, -1));
  for (const p of ["/api/feed", "/api/bootstrap", "/api/posts/p_1", "/api/posts/p_1/paragraphs"]) assert.ok(READ.test(p), p);
  for (const p of ["/api/auth/me", "/api/messages", "/api/wallet", "/api/drafts"]) assert.ok(!READ.test(p), p);
  const H = await boot();
  try { const r = await fetch(H.base + "/sw.js"); assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-cache"); assert.equal(r.headers.get("service-worker-allowed"), "/"); }
  finally { await H.app.close(); }
});

test("capacitor config: bundled by default, live https URL only", async () => {
  const { config } = await import(path.join(ROOT, "tools", "capacitor.mjs"));
  const d = config({}); assert.equal(d.webDir, "dist"); assert.equal(d.server.url, undefined); assert.equal(d.appId, "plus.mujtama.app");
  assert.equal(config({ CAP_SERVER_URL: "https://mujtama.example/" }).server.url, "https://mujtama.example");
  assert.equal(config({ CAP_SERVER_URL: "http://insecure.example" }).server.url, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, "capacitor.config.json"), "utf8")).webDir, "dist");
});
