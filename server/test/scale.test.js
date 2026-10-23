/* Phase 48 — horizontal scaling adapters. No real Redis/NATS is needed: tiny in-test fakes speak the RESP2 and NATS text
 * protocols to the zero-dependency clients (redis-lite / nats-lite). Covers: defaults stay in-process; unreachable
 * REDIS_URL/NATS_URL fall back; shared cache L2 + cross-node invalidation; distributed rate limit across two nodes + exact
 * hitAsync; NATS bus delivers each event once per cluster (queue group) and falls back when down; realtime fan-out;
 * ROLE gating (queue kinds, scheduled jobs, worker HTTP surface); shard helper; CDN headers; full app boot with
 * Redis+NATS (session cache revocation on logout, /api/admin/scale). SQLite by default, PostgreSQL with TEST_DATABASE_URL. */
const test = require("node:test"), assert = require("node:assert"), net = require("node:net");
const { boot } = require("./helpers");
const S = require("../lib/scale"), Shard = require("../lib/shard");
const { createParser, encode } = require("../lib/redis-lite");
const { createRedis } = require("../lib/redis-lite"), { createNats } = require("../lib/nats-lite");
const { EventBus } = require("../lib/core");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(10); } return false; };

/* ---------- fake Redis (RESP2) ---------- */
function fakeRedis() {
  const store = new Map(), subs = new Map(), conns = new Set(); let commands = 0;
  const live = (k) => { const e = store.get(k); if (!e) return null; if (e.exp && e.exp < Date.now()) { store.delete(k); return null; } return e; };
  const bulk = (v) => (v == null ? "$-1\r\n" : "$" + Buffer.byteLength(v) + "\r\n" + v + "\r\n");
  const arr = (xs) => "*" + xs.length + "\r\n" + xs.map((x) => (Array.isArray(x) ? arr(x) : typeof x === "number" ? ":" + x + "\r\n" : bulk(x))).join("");
  const server = net.createServer((sock) => {
    conns.add(sock); const p = createParser();
    sock.on("close", () => { conns.delete(sock); for (const s of subs.values()) s.delete(sock); });
    sock.on("error", () => { });
    sock.on("data", (d) => {
      for (const [c0, ...a] of p.feed(d)) {
        commands++; const c = String(c0).toUpperCase();
        if (c === "AUTH" || c === "SELECT") sock.write("+OK\r\n");
        else if (c === "PING") sock.write("+PONG\r\n");
        else if (c === "GET") sock.write(bulk(live(a[0])?.v ?? null));
        else if (c === "SET") { const i = a.findIndex((x) => String(x).toUpperCase() === "PX"); store.set(a[0], { v: a[1], exp: i > 0 ? Date.now() + +a[i + 1] : 0 }); sock.write("+OK\r\n"); }
        else if (c === "DEL") { let n = 0; for (const k of a) if (store.delete(k)) n++; sock.write(":" + n + "\r\n"); }
        else if (c === "INCR") { const e = live(a[0]) || { v: "0", exp: 0 }; e.v = String(+e.v + 1); store.set(a[0], e); sock.write(":" + e.v + "\r\n"); }
        else if (c === "PEXPIRE") { const e = live(a[0]); if (e) e.exp = Date.now() + +a[1]; sock.write(":" + (e ? 1 : 0) + "\r\n"); }
        else if (c === "SCAN") { const m = String(a[a.indexOf("MATCH") + 1]).replace(/\*$/, "").replace(/\\(.)/g, "$1"); sock.write(arr(["0", [...store.keys()].filter((k) => k.startsWith(m) && live(k))])); }
        else if (c === "PUBLISH") { const s = subs.get(a[0]) || new Set(); for (const x of s) x.write(arr(["message", a[0], a[1]])); sock.write(":" + s.size + "\r\n"); }
        else if (c === "SUBSCRIBE") { a.forEach((ch, i) => { if (!subs.has(ch)) subs.set(ch, new Set()); subs.get(ch).add(sock); sock.write(arr(["subscribe", ch, i + 1])); }); }
        else sock.write("-ERR unknown command " + c + "\r\n");
      }
    });
  });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res({ url: `redis://:pw@127.0.0.1:${server.address().port}/0`, store, get commands() { return commands; },
    close: () => new Promise((r) => { for (const c of conns) c.destroy(); server.close(r); }) })));
}

/* ---------- fake NATS ---------- */
function fakeNats() {
  const subs = [], conns = new Set(); let rr = 0;
  const match = (pat, subj) => (pat.endsWith(">") ? subj.startsWith(pat.slice(0, -1)) : pat === subj);
  const server = net.createServer((sock) => {
    conns.add(sock); let buf = "";
    sock.on("close", () => { conns.delete(sock); for (let i = subs.length - 1; i >= 0; i--) if (subs[i].sock === sock) subs.splice(i, 1); });
    sock.on("error", () => { });
    sock.write('INFO {"server_id":"fake","max_payload":1048576}\r\n');
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      for (;;) {
        const nl = buf.indexOf("\r\n"); if (nl < 0) return;
        const line = buf.slice(0, nl);
        if (line.startsWith("PUB ")) {
          const [, subj, n] = line.split(" "); const bytes = +n; if (Buffer.byteLength(buf) < nl + 2 + bytes + 2) return;
          const b = Buffer.from(buf, "utf8"), payload = b.subarray(nl + 2, nl + 2 + bytes).toString("utf8"); buf = b.subarray(nl + 2 + bytes + 2).toString("utf8");
          const hits = subs.filter((s) => match(s.subject, subj)), groups = new Map();
          for (const s of hits) { if (!s.queue) s.sock.write(`MSG ${subj} ${s.sid} ${Buffer.byteLength(payload)}\r\n${payload}\r\n`); else { if (!groups.has(s.queue)) groups.set(s.queue, []); groups.get(s.queue).push(s); } }
          for (const g of groups.values()) { const s = g[rr++ % g.length]; s.sock.write(`MSG ${subj} ${s.sid} ${Buffer.byteLength(payload)}\r\n${payload}\r\n`); }
          continue;
        }
        buf = buf.slice(nl + 2);
        if (line === "PING") sock.write("PONG\r\n");
        else if (line.startsWith("SUB ")) { const p = line.split(" "); subs.push({ sock, subject: p[1], queue: p.length === 4 ? p[2] : null, sid: p[p.length - 1] }); }
      }
    });
  });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res({ url: `nats://127.0.0.1:${server.address().port}`, subs,
    close: () => new Promise((r) => { for (const c of conns) c.destroy(); server.close(r); }) })));
}
const closedPort = async () => { const s = net.createServer(); await new Promise((r) => s.listen(0, "127.0.0.1", r)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };
const quiet = { warn() { }, error() { }, info() { } };

test("pure helpers: roles, plain-data guard, shard keys, CDN headers", () => {
  assert.equal(S.parseRole(undefined), "all"); assert.equal(S.parseRole("bogus"), "all"); assert.equal(S.parseRole("worker-media"), "worker-media");
  assert.ok(S.runsKind("all", "video") && S.runsKind("worker-media", "video") && !S.runsKind("web", "video") && !S.runsKind("worker-notify", "video"));
  assert.ok(S.runsKind("web", "some.future.kind") && !S.runsKind("worker-media", "notify.push") && S.runsKind("worker-notify", "mail.send"));
  assert.ok(S.runsJob("worker-search", "searchSync") && !S.runsJob("web", "searchSync") && S.runsJob("web", "chatExpiry") && !S.runsJob("worker-search", "chatExpiry"));
  assert.ok(S.allowsHttp("web", "/api/feed") && S.allowsHttp("worker-media", "/api/health") && !S.allowsHttp("worker-media", "/api/feed"));
  assert.ok(S.isPlain({ a: [1, "x", null, { b: true }] }) && !S.isPlain({ d: new Date() }) && !S.isPlain({ b: Buffer.from("x") }) && !S.isPlain({ n: NaN }) && !S.isPlain(new Map()));
  assert.equal(Shard.shardCount({}), 1); assert.equal(Shard.shardOf("u_abc", 1), 0);
  const counts = new Array(8).fill(0); for (let i = 0; i < 4000; i++) counts[Shard.shardOf("u_" + i, 8)]++;
  assert.ok(counts.every((c) => c > 350 && c < 650), "jump hash spreads evenly: " + counts);
  let moved = 0; for (let i = 0; i < 4000; i++) if (Shard.shardOf("u_" + i, 8) !== Shard.shardOf("u_" + i, 9)) moved++;
  assert.ok(moved < 4000 / 9 * 1.3, "growing 8→9 moves ~1/9 of keys, moved " + moved);
  assert.equal(Shard.shardForRow("posts", { author: "u_1" }, 4), Shard.shardOf("u_1", 4)); assert.equal(Shard.shardForRow("audit_log", {}, 4), null);
  assert.throws(() => Shard.shardForRow("nope", {})); assert.equal(Shard.shardDsn(2, { DATABASE_URL: "pg://a", SHARD_2_DATABASE_URL: "pg://b" }), "pg://b");
  assert.deepEqual(S.cdnHeaders({ hashed: true }, {}), {});
  assert.match(S.cdnHeaders({ hashed: true }, { CDN_CACHE: "1" })["CDN-Cache-Control"], /immutable/);
  assert.equal(S.cdnHeaders({ html: true }, { CDN_CACHE: "1" })["CDN-Cache-Control"], "no-store");
  assert.match(S.cdnHeaders({}, { CDN_CACHE: "1", CDN_EDGE_TTL: "600" })["CDN-Cache-Control"], /max-age=600/);
});

test("defaults are in-process; unreachable REDIS_URL / NATS_URL fall back", async () => {
  const d = await S.createScale({ env: {}, log: quiet });
  assert.deepEqual(d.scale.adapters, { bus: "memory", cache: "memory", rateLimit: "memory", realtime: "local", sessions: "db" });
  assert.equal(d.scale.role, "all"); assert.equal(d.bus.constructor.name, "EventBus"); assert.equal(d.cache.constructor.name, "Cache");
  const p = await closedPort(), t = Date.now();
  const f = await S.createScale({ env: { REDIS_URL: `redis://127.0.0.1:${p}`, NATS_URL: `nats://127.0.0.1:${p}`, SCALE_CONNECT_TIMEOUT_MS: "300" }, log: quiet });
  assert.equal(f.scale.adapters.bus, "memory"); assert.equal(f.scale.adapters.cache, "memory"); assert.equal(f.scale.adapters.rateLimit, "memory");
  assert.ok(Date.now() - t < 2000); await S.closeScale(f.scale);
  let got = 0; f.bus.on("POST_CREATED", () => got++); f.bus.emit("POST_CREATED", {}); await until(() => got === 1); assert.equal(got, 1);
});

test("Redis: shared cache L2 + cross-node invalidation, distributed rate limit, realtime fan-out, reconnect fallback", async () => {
  const R = await fakeRedis();
  const A = await S.createScale({ env: { REDIS_URL: R.url }, log: quiet }), B = await S.createScale({ env: { REDIS_URL: R.url }, log: quiet });
  try {
    assert.equal(A.scale.adapters.cache, "redis"); assert.equal(A.scale.adapters.rateLimit, "redis");
    // L2: value computed on A is reused by B without recomputation
    let computed = 0; const v1 = await A.cache.wrap("feed:u1", 30e3, async () => (++computed, { items: [1, 2] }));
    await until(() => R.store.has("mp:c:feed:u1"));
    const v2 = await B.cache.wrap("feed:u1", 30e3, async () => (++computed, { items: [9] }));
    assert.deepEqual(v2, v1); assert.equal(computed, 1); assert.equal(B.cache.stats.l2hit, 1); assert.deepEqual(B.cache.get("feed:u1"), { items: [1, 2] });
    // non-plain values stay L1-only (no type drift through JSON)
    A.cache.set("d:1", { at: new Date() }); await wait(30); assert.ok(!R.store.has("mp:c:d:1"));
    // invalidation on A drops B's L1 and the L2 copy
    A.cache.del("feed:"); assert.ok(await until(() => B.cache.get("feed:u1") === undefined && !R.store.has("mp:c:feed:u1")));
    // distributed rate limit: community = 3/hour cluster-wide
    assert.ok(A.rl.hit("community", "u9")); assert.ok(A.rl.hit("community", "u9")); await wait(30);
    assert.ok(B.rl.hit("community", "u9")); await wait(30); // B's INCR learns the cluster count (3)
    assert.equal(B.rl.hit("community", "u9"), false, "4th hit on another node is limited");
    assert.equal(await B.rl.hitAsync("register", "1.2.3.4"), true);
    for (let i = 0; i < 4; i++) await A.rl.hitAsync("register", "1.2.3.4");
    assert.equal(await B.rl.hitAsync("register", "1.2.3.4"), false, "hitAsync is exact across nodes");
    assert.ok(A.rl.w instanceof Map, "local window kept (tests/automod use it)");
    // realtime fan-out: send on A reaches B's local clients, not echoed back to A
    const mk = () => { const got = []; return { got, send: (u, t, d) => got.push(["s", u, t, d]), broadcast: (t, d) => got.push(["b", t, d]) }; };
    const ra = mk(), rb = mk(); await S.fanoutRealtime(ra, A.scale.redis, { nodeId: "A" }).ready; await S.fanoutRealtime(rb, B.scale.redis, { nodeId: "B" }).ready;
    ra.send("u1", "notification", { n: 1 }); ra.broadcast("trend", { t: "#x" });
    assert.ok(await until(() => rb.got.length === 2)); assert.deepEqual(rb.got[0], ["s", "u1", "notification", { n: 1 }]); assert.deepEqual(rb.got[1], ["b", "trend", { t: "#x" }]);
    await wait(30); assert.equal(ra.got.length, 2, "A delivered locally once, no echo");
  } finally { await S.closeScale(A.scale); await S.closeScale(B.scale); }
  // Redis going away: the limiter and cache keep working in-process
  const C = await S.createScale({ env: { REDIS_URL: R.url }, log: quiet }); await R.close(); await until(() => !C.scale.redis.ready);
  assert.ok(C.rl.hit("comment", "z")); assert.equal(await C.rl.hitAsync("comment", "z"), true);
  assert.deepEqual(await C.cache.wrap("k", 1000, async () => 5), 5); await S.closeScale(C.scale);
});

test("redis-lite: RESP parser handles split frames, nested arrays, errors and nulls", () => {
  const p = createParser(), whole = Buffer.from("+OK\r\n:42\r\n$-1\r\n*2\r\n$3\r\nabc\r\n*1\r\n:1\r\n-ERR bad\r\n$4\r\nعر\r\n");
  const out = []; for (let i = 0; i < whole.length; i += 3) out.push(...p.feed(whole.subarray(i, i + 3)));
  assert.equal(out[0], "OK"); assert.equal(out[1], 42); assert.equal(out[2], null); assert.deepEqual(out[3], ["abc", [1]]); assert.ok(out[4] instanceof Error); assert.equal(out[5], "عر");
  assert.equal(encode(["SET", "k", "عر"]).toString("utf8"), "*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$4\r\nعر\r\n");
});

test("NATS bus: each event handled once per cluster (queue group); falls back in-process when down", async () => {
  const N = await fakeNats();
  const A = await S.createScale({ env: { NATS_URL: N.url }, log: quiet }), B = await S.createScale({ env: { NATS_URL: N.url }, log: quiet });
  try {
    assert.equal(A.scale.adapters.bus, "nats"); assert.ok(A.bus instanceof EventBus);
    const seen = { A: [], B: [] }; A.bus.on("POST_CREATED", (p) => seen.A.push(p.post)); B.bus.on("POST_CREATED", (p) => seen.B.push(p.post));
    let star = 0; A.bus.on("*", () => star++); B.bus.on("*", () => star++);
    for (let i = 0; i < 10; i++) (i % 2 ? A : B).bus.emit("POST_CREATED", { post: "p" + i, data: { ar: "مرحبا" } });
    assert.ok(await until(() => seen.A.length + seen.B.length === 10));
    await wait(50); assert.equal(seen.A.length + seen.B.length, 10, "exactly once across nodes");
    assert.deepEqual([...seen.A, ...seen.B].sort(), Array.from({ length: 10 }, (_, i) => "p" + i).sort());
    assert.ok(seen.A.length > 0 && seen.B.length > 0, "work spreads over the group"); assert.equal(star, 10);
    // non-JSON payload stays in-process
    let local = 0; A.bus.on("VIDEO_PROCESSED", (p) => { if (p.buf instanceof Buffer) local++; }); A.bus.emit("VIDEO_PROCESSED", { buf: Buffer.from("x") });
    assert.ok(await until(() => local === 1)); assert.equal(A.bus.stats.local, 1);
    // NATS down → emits are delivered locally
    await N.close(); await until(() => !A.scale.nats.ready);
    let after = 0; A.bus.on("USER_FOLLOWED", () => after++); A.bus.emit("USER_FOLLOWED", {}); assert.ok(await until(() => after === 1));
  } finally { await S.closeScale(A.scale); await S.closeScale(B.scale); }
});

test("nats-lite / redis-lite clients: auth in URL is masked, publish refuses when disconnected", async () => {
  const p = await closedPort();
  const n = createNats(`nats://user:secret@127.0.0.1:${p}`, { log: quiet }); assert.ok(!n.url.includes("secret")); assert.equal(n.publish("x", "y"), false); n.close();
  const r = createRedis(`redis://:secret@127.0.0.1:${p}`, { log: quiet }); assert.ok(!r.url.includes("secret")); await assert.rejects(r.get("k"), /not connected/); r.close();
});

test("ROLE gating: queue kinds, scheduled jobs, worker HTTP surface", async () => {
  const fakeCtx = (role) => { const q = { kinds: [], on(k) { this.kinds.push(k); } }, s = { jobs: [], every(n) { this.jobs.push(n); return this; } }; return { scale: { role }, queue: q, scheduler: s }; };
  for (const [role, kinds, jobs] of [["all", ["video", "notify.push", "x"], ["searchSync", "chatExpiry"]], ["web", ["x"], ["chatExpiry"]], ["worker-media", ["video"], []], ["worker-notify", ["notify.push"], []], ["worker-search", [], ["searchSync"]]]) {
    const c = fakeCtx(role); S.applyRole(c);
    for (const k of ["video", "notify.push", "x"]) c.queue.on(k, () => { });
    c.scheduler.every("searchSync", 1, () => { }).every("chatExpiry", 1, () => { });
    assert.deepEqual(c.queue.kinds, kinds, role + " kinds"); assert.deepEqual(c.scheduler.jobs, jobs, role + " jobs");
  }
  const W = await boot({ role: "worker-media" });
  try {
    const c = new W.Client();
    assert.equal((await c.req("GET", "/api/health")).ok, true);
    const r = await c.req("GET", "/api/feed"); assert.equal(r.status, 404); assert.equal(r.code, "worker_role");
    assert.equal(W.app.ctx.scale.role, "worker-media");
  } finally { await W.app.close(); }
});

test("app: default boot unchanged; Redis+NATS boot wires adapters, session cache revokes on logout, admin status", async () => {
  const D = await boot();
  try {
    const c = new D.Client(); const reg = await c.req("POST", "/api/auth/register", { name: "مدير", handle: "admin48", password: "password123" });
    assert.ok(reg.user);
    const st = await c.req("GET", "/api/admin/scale");
    assert.equal(st.role, "all"); assert.deepEqual(st.adapters, { bus: "memory", cache: "memory", rateLimit: "memory", realtime: "local", sessions: "db" });
    assert.equal((await new D.Client().req("GET", "/api/admin/scale")).status, 401);
    const h = await fetch(D.base + "/index.html"); assert.equal(h.headers.get("cdn-cache-control"), null, "no CDN header unless CDN_CACHE=1");
  } finally { await D.app.close(); }

  const R = await fakeRedis(), N = await fakeNats();
  process.env.REDIS_SESSION_CACHE_MS = "30000";
  const X = await boot({ redisUrl: R.url, natsUrl: N.url });
  try {
    const ctx = X.app.ctx;
    assert.deepEqual(ctx.scale.adapters, { bus: "nats", cache: "redis", rateLimit: "redis", realtime: "redis", sessions: "redis" });
    const a = new X.Client(), b = new X.Client();
    assert.ok((await a.req("POST", "/api/auth/register", { name: "مدير", handle: "admin48", password: "password123" })).user);
    assert.ok((await b.req("POST", "/api/auth/register", { name: "سارة", handle: "sara48", password: "password123" })).user);
    assert.equal((await b.req("GET", "/api/me")).user.handle, "sara48");
    assert.ok([...R.store.keys()].some((k) => k.startsWith("mp:s:")), "session row cached in Redis");
    assert.equal((await b.req("GET", "/api/me")).user.handle, "sara48", "served from the session cache");
    const cookie = b.cookie; await b.req("POST", "/api/auth/logout");
    const stale = new X.Client(); stale.cookie = cookie;
    assert.equal((await stale.req("GET", "/api/me")).status, 401, "logout invalidates the cached session");
    // events flow through NATS and back to this node's handlers
    const before = ctx.bus.stats.published; let got = 0; ctx.bus.on("POST_CREATED", () => got++);
    const post = await a.req("POST", "/api/posts", { text: "منشور التوسع الأفقي #تجربة" });
    assert.ok(post.post || post.id, JSON.stringify(post).slice(0, 200));
    assert.ok(await until(() => got >= 1)); assert.ok(ctx.bus.stats.published > before && ctx.bus.stats.received > 0);
    const st = await a.req("GET", "/api/admin/scale");
    assert.equal(st.adapters.bus, "nats"); assert.equal(st.redis.ready, true); assert.equal(st.nats.ready, true); assert.ok(st.stats.realtime);
  } finally { delete process.env.REDIS_SESSION_CACHE_MS; await X.app.close(); await R.close(); await N.close(); }
});
