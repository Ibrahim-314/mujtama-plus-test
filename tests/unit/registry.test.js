/* v2.51 — registries (registry.js) replace the override chains. These tests prove parity with the old chains:
 * the same layers, written the old way (window.ExtraRoutes wrappers / Views.settings wrappers / Remote.api wrappers)
 * and the new way (MPRoutes / MPSettings / Remote.use), give the same results; plus a guard that no module re-assigns
 * those globals any more. */
const test = require("node:test"), assert = require("node:assert"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const ROOT = path.join(__dirname, "..", "..");

function boot() {
  const calls = [];
  const ctx = { console: { error() { } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, dispatchEvent() { }, calls };
  ctx.window = ctx;
  ctx.Views = { settings() { calls.push("base-settings"); }, profile(a) { calls.push("profile:" + (a || "me")); }, notFound() { calls.push("notFound"); } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "registry.js"), "utf8"), ctx, { filename: "registry.js" });
  return ctx;
}
/* the old chain, built literally the way the modules used to do it */
function oldChain(layers) {
  let ER;
  for (const l of layers) { const prev = ER; ER = (a, b) => ({ ...(prev ? prev(a, b) : {}), ...l(a, b, prev ? prev(a, b) : {}) }); }
  return ER;
}
const run = (table, r, ctx, coreFallback) => { ctx.calls.length = 0; const h = table[r]; if (h) h(); else coreFallback(r); return ctx.calls.join(","); };

test("MPRoutes: extend + add(next) give exactly what the old wrapper chain gave", () => {
  const ctx = boot();
  const log = (s) => () => ctx.calls.push(s);
  // old-style layers (prev-aware), mirroring v12 → pi → transfers → biz → a11y → ads …
  const OLD = [
    (a, b) => ({ admin: log("v12-admin"), series: log("v12-series:" + a) }),
    (a, b, prev) => ({ wallet: log("pi-wallet"), admin: () => { if (a === "pi") return ctx.calls.push("pi-admin"); (prev.admin || ctx.Views.notFound)(); ctx.calls.push("pi-card"); } }),
    (a, b, prev) => ({ wallet: () => { (prev.wallet || ctx.Views.notFound)(); ctx.calls.push("tr-link"); }, admin: () => (a === "transfers" ? ctx.calls.push("tr-admin") : (prev.admin || ctx.Views.notFound)()) }),
    (a, b, prev) => { const admin = prev.admin; return { biz: log("biz:" + a), admin: () => (a === "biz" ? ctx.calls.push("biz-admin") : (admin || ctx.Views.notFound)()) }; },
    (a, b, prev) => { const out = { ...prev, a11y: log("a11y") }; if (a === "display") out.settings = log("a11y-display"); return out; },
    (a, b, prev) => ({ settings: () => (a === "ads" ? ctx.calls.push("ads-prefs") : (prev.settings || (() => ctx.Views.settings()))()), me: () => (a === "supporting" ? ctx.calls.push("supporting") : (prev.me || (() => ctx.Views.profile()))()), u: () => (b === "support" ? ctx.calls.push("support:" + a) : (prev.u || (() => ctx.Views.profile(a)))()) }),
    (a, b, prev) => ({ creator: () => { (prev.creator || ctx.Views.notFound)(); ctx.calls.push("paid-link"); } })
  ];
  const ER = oldChain(OLD);
  // the same, migrated the way the v2.51 modules are
  const R = ctx.MPRoutes;
  R.extend((a, b) => ({ admin: log("v12-admin"), series: log("v12-series:" + a) }));
  R.extend(() => ({ wallet: log("pi-wallet") }));
  R.add("admin", (a, b, next) => { if (a === "pi") return ctx.calls.push("pi-admin"); next(); ctx.calls.push("pi-card"); });
  R.add("wallet", (a, b, next) => { next(); ctx.calls.push("tr-link"); });
  R.add("admin", (a, b, next) => (a === "transfers" ? ctx.calls.push("tr-admin") : next()));
  R.extend((a) => ({ biz: log("biz:" + a) }));
  R.add("admin", (a, b, next) => (a === "biz" ? ctx.calls.push("biz-admin") : next()));
  R.extend(() => ({ a11y: log("a11y") }));
  R.add("settings", (a, b, next) => (a === "display" ? ctx.calls.push("a11y-display") : next()));
  R.add("settings", (a, b, next) => (a === "ads" ? ctx.calls.push("ads-prefs") : next()));
  R.add("me", (a, b, next) => (a === "supporting" ? ctx.calls.push("supporting") : next()));
  R.add("u", (a, b, next) => (b === "support" ? ctx.calls.push("support:" + a) : next()));
  R.add("creator", (a, b, next) => { next(); ctx.calls.push("paid-link"); });
  // app.js route(): core routes first, ExtraRoutes spread over them, unknown → notFound
  const core = (r, a) => ({ settings: () => ctx.Views.settings(), me: () => ctx.Views.profile(), u: () => ctx.Views.profile(a) }[r] || ctx.Views.notFound)();
  const cases = [["admin"], ["admin", "pi"], ["admin", "transfers"], ["admin", "biz"], ["admin", "nope"], ["wallet"], ["series", "x"], ["biz", "new"],
    ["settings"], ["settings", "display"], ["settings", "ads"], ["me"], ["me", "supporting"], ["u", "sara"], ["u", "sara", "support"], ["creator"], ["a11y"], ["unknown"]];
  for (const [r, a, b] of cases) {
    const before = run(ER(a, b), r, ctx, (x) => core(x, a)), after = run(ctx.ExtraRoutes(a, b), r, ctx, (x) => core(x, a));
    assert.equal(after, before, `#/${[r, a, b].filter(Boolean).join("/")}`);
    assert.ok(after.length, "something rendered for " + r);
  }
  // a layer that throws no longer breaks every later layer
  R.extend(() => { throw new Error("broken chunk"); });
  R.extend(() => ({ later: log("later") }));
  assert.equal(run(ctx.ExtraRoutes(), "later", ctx, () => { }), "later");
});

test("MPSettings: hooks run after the base screen, in registration order, isolated from each other", () => {
  const ctx = boot(), order = [];
  ctx.MPSettings.add(() => order.push("v12")); ctx.MPSettings.add(() => order.push("sync"));
  ctx.MPSettings.add(() => { throw new Error("bad hook"); }); ctx.MPSettings.add(() => order.push("pi"));
  ctx.calls.length = 0; ctx.Views.settings();
  assert.deepEqual(ctx.calls, ["base-settings"]); assert.deepEqual(order, ["v12", "sync", "pi"]);
});

test("MPSession: whenIn waits for sign-in, runs at once when signed in", () => {
  const ctx = boot(), S = ctx.MPSession, seen = [];
  assert.equal(S.state, "unknown"); S.whenIn(() => seen.push(1)); S.set("out"); assert.deepEqual(seen, []);
  S.set("in"); assert.deepEqual(seen, [1]); S.whenIn(() => seen.push(2)); assert.deepEqual(seen, [1, 2]); assert.equal(S.signedIn(), true);
});

test("Remote.use: middleware order, per-request headers (no window.fetch patch), below() skips one middleware", async () => {
  const src = fs.readFileSync(path.join(ROOT, "sync.js"), "utf8"), start = src.indexOf("const Remote = {"), end = src.indexOf("\n};", start) + 3;
  const sent = [];
  const ctx = { fetch: async (p, o) => { sent.push({ p, h: o.headers, body: o.body }); return { ok: true, json: async () => ({ ok: 1 }) }; }, JSON, Promise };
  vm.createContext(ctx); vm.runInContext(src.slice(start, end) + ";globalThis.R=Remote;", ctx);
  const R = ctx.R, origFetch = ctx.fetch, order = [];
  R.use((req, next) => { order.push("content"); return next(req); });
  R.use((req, next) => next({ ...req, headers: { ...req.headers, "X-Act-As": "org1" } })); // identity (act-as)
  const nudge = R.use(async (req, next) => { order.push("automod"); return next(req); });
  await R.api("POST", "/api/posts", { text: "x" });
  assert.deepEqual(order, ["automod", "content"], "last registered runs first (old wrapper order)");
  assert.equal(sent[0].h["X-Act-As"], "org1"); assert.equal(sent[0].h["X-Requested-With"], "mujtama");
  assert.equal(ctx.fetch, origFetch, "window.fetch never replaced");
  order.length = 0; await R.below(nudge, "GET", "/api/x"); assert.deepEqual(order, ["content"], "below() = the chain without that middleware");
  const api = R.api; await api("GET", "/api/unbound"); assert.equal(sent.at(-1).p, "/api/unbound", "works unbound");
});

test("no module re-assigns window.ExtraRoutes, Views.settings or Remote.api any more", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const files = [...html.matchAll(/<script src="((?:[\w-]+\/)*[\w.-]+\.js)"/g)].map((m) => m[1]).filter((f) => !f.startsWith("vendor/"));
  assert.ok(files.indexOf("registry.js") === files.indexOf("app.js") + 1, "registry.js loads right after app.js");
  for (const f of files) {
    if (f === "registry.js") continue;
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!/window\.ExtraRoutes\s*=[^=]/.test(s), f + " assigns window.ExtraRoutes");
    assert.ok(!/Views\.settings\s*=[^=]/.test(s), f + " assigns Views.settings");
    assert.ok(!/Remote\.api\s*=[^=]/.test(s), f + " assigns Remote.api");
  }
});
