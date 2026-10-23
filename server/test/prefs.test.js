/* Phase 44 — personalization: server-stored preferences (user_prefs, namespaces, JSON values), cross-device sync,
 * alternate app icons + manifest. SQLite by default and PostgreSQL with TEST_DATABASE_URL.
 * Covers: migration 027 (down/up, static additive), catalogue (free, palettes/icons/nav/densities), GET/PUT/DELETE /api/prefs
 * (strict `ui` validation, free-form namespaces, null deletes, reserved a11y, caps, auth + CSRF), rev / unchanged, two devices of one
 * user stay in step (last write wins per key) and users are isolated, realtime "prefs" ping, PNG icons (valid signature, sizes, CRC),
 * per-icon manifest, compliance data map + export/erase coverage. */
const test = require("node:test"), assert = require("node:assert");
const zlib = require("node:zlib");
const { boot } = require("./helpers");

let H, a1, a2, b;
const db = () => H.app.ctx.db;
const mk = async (handle, ua) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(ua); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
};
const login = async (handle, ua) => { const c = new H.Client(ua); const r = await c.req("POST", "/api/auth/login", { handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; return c; };

test.before(async () => {
  H = await boot();
  a1 = await mk("pf_amal");
  a2 = await login("pf_amal", "Mozilla/5.0 (Linux; Android 14) Chrome/120"); // the same user on a second device
  b = await mk("pf_badr");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 027: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '027_prefs' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "027_prefs"]);
  await assert.rejects(() => db().get("SELECT 1 FROM user_prefs"));
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM users")).n) >= 2, "users untouched");
  assert.deepEqual(await mig.up(db()), ["027_prefs", ...later]);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM user_prefs")).n), 0);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
  assert.ok(s.seen.some((x) => x.file === "027_prefs.js"));
});

test("catalogue is public and free: modes, palettes, OLED, densities, nav items, icons", async () => {
  const c = await new H.Client().req("GET", "/api/prefs/catalog");
  assert.equal(c.status, 200); assert.equal(c.free, true); assert.equal(c.oled, true);
  assert.deepEqual(c.modes, ["system", "light", "dark"]);
  assert.deepEqual(c.densities, ["comfortable", "compact"]);
  assert.deepEqual(c.nav, ["home", "explore", "communities", "notifications", "menu"]);
  assert.ok(c.palettes.length >= 6 && c.palettes.every((p) => /^#[0-9a-f]{6}$/.test(p.accent.light) && p.brand.length === 3));
  assert.ok(c.icons.length >= 6 && c.icons.every((i) => i.href.startsWith("/api/prefs/icons/") && i.manifest.includes(i.id)));
  assert.deepEqual(c.defaults, { theme: "system", palette: "violet", oled: false, density: "comfortable", nav: c.nav, icon: "classic", sync: true });
});

test("GET/PUT /api/prefs: ui namespace validated strictly, other namespaces free-form JSON, null deletes", async () => {
  assert.equal((await new H.Client().req("GET", "/api/prefs")).status, 401);
  const empty = await a1.req("GET", "/api/prefs"); assert.equal(empty.status, 200); assert.deepEqual(empty.prefs, {}); assert.equal(empty.syncedAt, null);
  const r = await a1.req("PUT", "/api/prefs", { ns: "ui", values: { theme: "dark", palette: "ocean", oled: true, density: "compact", nav: ["menu", "home", "explore", "communities", "notifications"], icon: "midnight" } });
  assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.prefs.ui, { density: "compact", icon: "midnight", nav: ["menu", "home", "explore", "communities", "notifications"], oled: true, palette: "ocean", theme: "dark" });
  // v2.52: an order saved before the hub (with "me") is accepted and stored as "menu"
  const legacy = await a1.req("PUT", "/api/prefs", { ns: "ui", values: { nav: ["home", "me", "explore", "communities", "notifications"] } });
  assert.equal(legacy.status, 200, legacy.error); assert.deepEqual(legacy.prefs.ui.nav, ["home", "menu", "explore", "communities", "notifications"]);
  await a1.req("PUT", "/api/prefs", { ns: "ui", values: { nav: ["menu", "home", "explore", "communities", "notifications"] } });
  assert.ok(r.rev && r.updatedAt.ui.theme && r.syncedAt);
  for (const [values, code] of [[{ theme: "neon" }, "bad_pref"], [{ palette: "plaid" }, "bad_pref"], [{ oled: "yes" }, "bad_pref"], [{ density: "tiny" }, "bad_pref"], [{ icon: "x" }, "bad_pref"],
    [{ nav: ["home", "home", "explore", "communities", "menu"] }, "bad_pref"], [{ nav: ["me", "menu", "explore", "communities", "home"] }, "bad_pref"], [{ nav: ["home"] }, "bad_pref"], [{ fontSize: 3 }, "bad_pref"], [{ "bad key": 1 }, "bad_key"]]) {
    const x = await a1.req("PUT", "/api/prefs", { ns: "ui", values });
    assert.equal(x.status, 400, JSON.stringify(values)); assert.equal(x.code, code, JSON.stringify(values)); assert.ok(x.error);
  }
  // a batch with one bad key changes nothing
  assert.equal((await a1.req("PUT", "/api/prefs", { ns: "ui", values: { theme: "light", palette: "nope" } })).status, 400);
  assert.equal((await a1.req("GET", "/api/prefs")).prefs.ui.theme, "dark");
  // free-form namespace (later phases), multi-namespace batch, null deletes
  const m = await a1.req("PUT", "/api/prefs", { prefs: { feed: { tab: "following", hidden: ["ads"] }, ui: { palette: "rose" } } });
  assert.equal(m.status, 200, m.error); assert.deepEqual(m.prefs.feed, { hidden: ["ads"], tab: "following" }); assert.equal(m.prefs.ui.palette, "rose");
  const d = await a1.req("PUT", "/api/prefs", { ns: "feed", values: { hidden: null } }); assert.deepEqual(d.prefs.feed, { tab: "following" });
  const only = await a1.req("GET", "/api/prefs?ns=feed"); assert.deepEqual(Object.keys(only.prefs), ["feed"]);
  // namespaces: reserved a11y (phase 43 table), bad names
  assert.equal((await a1.req("PUT", "/api/prefs", { ns: "a11y", values: { fontSize: 2 } })).code, "reserved_namespace");
  assert.equal((await a1.req("PUT", "/api/prefs", { ns: "Bad NS", values: { a: 1 } })).code, "bad_namespace");
  assert.equal((await a1.req("PUT", "/api/prefs", { ns: "ui", values: [] })).status, 400);
  // caps: value size, keys per request
  assert.equal((await a1.req("PUT", "/api/prefs", { ns: "feed", values: { big: "x".repeat(5000) } })).code, "pref_too_large");
  assert.equal((await a1.req("PUT", "/api/prefs", { ns: "feed", values: Object.fromEntries(Array.from({ length: 65 }, (_, i) => ["k" + i, i])) })).code, "too_many");
  // CSRF header required on writes
  assert.equal((await a1.req("PUT", "/api/prefs", { ns: "ui", values: { theme: "light" } }, { "X-Requested-With": "" })).status, 403);
  // DELETE resets one namespace
  const del = await a1.req("DELETE", "/api/prefs?ns=feed"); assert.equal(del.status, 200); assert.equal(del.prefs.feed, undefined); assert.ok(del.prefs.ui);
});

test("namespace count cap rolls the batch back", async () => {
  const c = await mk("pf_caps");
  for (let i = 0; i < 16; i++) assert.equal((await c.req("PUT", "/api/prefs", { ns: "ns" + String(i).padStart(2, "0"), values: { a: i } })).status, 200);
  H.app.ctx.rl.w.clear();
  const x = await c.req("PUT", "/api/prefs", { ns: "ns16", values: { a: 1 } });
  assert.equal(x.status, 400); assert.equal(x.code, "too_many");
  assert.equal((await c.req("GET", "/api/prefs")).prefs.ns16, undefined);
});

test("sync across devices: rev / unchanged, last write wins per key, realtime ping, users isolated", async () => {
  const sent = []; const rt = H.app.ctx.realtime, orig = rt.send.bind(rt);
  rt.send = (uid, type, data) => { if (type === "prefs") sent.push({ uid, data }); return orig(uid, type, data); };
  try {
    const g1 = await a2.req("GET", "/api/prefs"); // device 2 sees device 1's choices
    assert.equal(g1.prefs.ui.palette, "rose"); assert.equal(g1.prefs.ui.theme, "dark");
    const same = await a2.req("GET", "/api/prefs?ns=ui&rev=" + g1.rev); assert.equal(same.unchanged, true); assert.equal(same.rev, g1.rev); assert.equal(same.prefs, undefined);
    const w = await a2.req("PUT", "/api/prefs", { ns: "ui", values: { density: "comfortable" } });
    assert.notEqual(w.rev, g1.rev);
    assert.deepEqual(sent.at(-1), { uid: a1.id, data: { rev: w.rev } });
    // device 1 polls with its old rev → full update; other keys keep device 1's values
    const g2 = await a1.req("GET", "/api/prefs?ns=ui&rev=" + g1.rev);
    assert.equal(g2.unchanged, undefined); assert.equal(g2.prefs.ui.density, "comfortable"); assert.equal(g2.prefs.ui.palette, "rose"); assert.equal(g2.rev, w.rev);
    // last write wins on the same key
    await a1.req("PUT", "/api/prefs", { ns: "ui", values: { theme: "light" } });
    await a2.req("PUT", "/api/prefs", { ns: "ui", values: { theme: "system" } });
    assert.equal((await a1.req("GET", "/api/prefs")).prefs.ui.theme, "system");
    // another user is untouched and cannot see them
    assert.deepEqual((await b.req("GET", "/api/prefs")).prefs, {});
    await b.req("PUT", "/api/prefs", { ns: "ui", values: { palette: "gold" } });
    assert.equal((await a1.req("GET", "/api/prefs")).prefs.ui.palette, "rose");
    assert.ok(sent.every((s) => s.uid === a1.id || s.uid === b.id));
  } finally { rt.send = orig; }
});

test("alternate app icons: valid PNGs per size, cacheable; per-icon web manifest", async () => {
  const L = require("../lib/prefs-lib");
  for (const id of ["classic", "ocean", "midnight"]) for (const size of [180, 192, 512]) {
    const r = await fetch(`${H.base}/api/prefs/icons/${id}-${size}.png`);
    assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png"); assert.match(r.headers.get("cache-control"), /immutable/);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(buf.toString("ascii", 12, 16), "IHDR"); assert.equal(buf.readUInt32BE(16), size); assert.equal(buf.readUInt32BE(20), size);
    assert.equal(buf.readUInt32BE(29), L.crc32(buf.subarray(12, 29)), "IHDR CRC");
    if (size === 180) { // centre pixel is the plus colour, the corner is the gradient start
      const idatLen = buf.readUInt32BE(33), raw = zlib.inflateSync(buf.subarray(41, 41 + idatLen)), row = size * 3 + 1;
      const px = (x, y) => [...raw.subarray(y * row + 1 + x * 3, y * row + 4 + x * 3)];
      const icon = L.ICONS.find((i) => i.id === id), hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
      assert.deepEqual(px(90, 90), hex(icon.c[2])); assert.deepEqual(px(0, 0), hex(icon.c[0]));
    }
  }
  for (const bad of ["nope-180.png", "classic-64.png", "classic-180.svg", "..%2Fx-180.png"]) assert.equal((await fetch(`${H.base}/api/prefs/icons/${bad}`)).status, 404, bad);
  const m = await fetch(`${H.base}/api/prefs/manifest.webmanifest?icon=forest`);
  assert.equal(m.status, 200); assert.match(m.headers.get("content-type"), /application\/manifest\+json/);
  const j = await m.json();
  assert.equal(j.display, "standalone"); assert.equal(j.dir, "rtl"); assert.equal(j.lang, "ar");
  assert.ok(j.icons.some((i) => i.src === "/api/prefs/icons/forest-512.png" && i.purpose === "maskable"));
  assert.equal((await fetch(`${H.base}/api/prefs/manifest.webmanifest?icon=zzz`)).status, 404);
});

test("compliance: user_prefs is in the data map, erased with the account", async () => {
  const C = require("../lib/compliance-lib");
  const m = C.DATA_MAP.find((x) => x.t === "user_prefs");
  assert.ok(m); assert.equal(m.erase, "delete"); assert.equal(m.purpose, "personalization"); assert.ok(m.cols.includes("value"));
});
