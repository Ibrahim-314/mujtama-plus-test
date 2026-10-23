/* Phase 47 — developer API. SQLite by default and PostgreSQL with TEST_DATABASE_URL.
 * Covers: migration 030 (down/up), pure helpers (scopes, PKCE, HMAC, backoff, URL policy, rate window, OpenAPI builder), portal
 * (apps, secrets/keys hashed at rest + shown once, rotate, revoke), public v1 reads (anonymous viewer only: no followers-only,
 * private-account, paid or private-community content; never messages), scopes, per-key rate limits + headers, OpenAPI generated
 * from routes, OAuth code + PKCE (consent, deny, code reuse, redirect/verifier mismatch, refresh rotation + reuse detection,
 * user revocation), writes as user (public only), webhooks (HMAC signature, retries with backoff, delivery log, retry),
 * bots (public-community install only, client_credentials, slash command + mention events, bot posting), admin suspend, CSRF. */
const test = require("node:test"), assert = require("node:assert");
const http = require("node:http"), crypto = require("node:crypto");
const { boot } = require("./helpers");
const L = require("../lib/devapi-lib");

let H, owner, sara, bob, admin, hook, hits = [], hookMode = "ok";
const db = () => H.app.ctx.db;
const svc = () => H.app.ctx.services.devapi;
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
};
const post = async (c, text, extra = {}) => { H.app.ctx.rl.w.clear(); const r = await c.req("POST", "/api/posts", { text, ...extra }); assert.equal(r.status, 200, r.error); return r.post.id; };
/** third-party call: bearer only, no cookie, no X-Requested-With */
async function call(method, path, { token, body, form, headers = {} } = {}) {
  const h = { ...headers }; if (token) h.Authorization = "Bearer " + token;
  let b; if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; b = new URLSearchParams(form).toString(); } else if (body) { h["Content-Type"] = "application/json"; b = JSON.stringify(body); }
  const r = await fetch(H.base + path, { method, headers: h, body: b, redirect: "manual" });
  const j = await r.json().catch(() => ({})); return { status: r.status, headers: r.headers, ...j };
}
const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return null; };

test.before(async () => {
  hook = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { hits.push({ headers: req.headers, body: b }); res.writeHead(hookMode === "ok" ? 200 : 500); res.end("x"); }); });
  await new Promise((r) => hook.listen(0, "127.0.0.1", r));
  H = await boot({ piOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, aiOpts: { jobs: false }, assistantOpts: { jobs: false, env: {} }, devapiOpts: { jobs: false, backoffMs: 1, allowPrivateUrls: true, env: { DEVAPI_RATE_PER_MIN: "1000" } } });
  admin = await mk("dv_admin"); owner = await mk("dv_owner"); sara = await mk("dv_sara"); bob = await mk("dv_bob");
});
test.after(async () => { await H.app.close(); hook.close(); });

test("migration 030 is additive and reversible", async () => {
  const M = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '030_devapi' ORDER BY id")).map((r) => r.id); // later phases (e.g. 032_ops)
  assert.deepEqual(await M.down(db(), later.length + 1), [...[...later].reverse(), "030_devapi"]);
  assert.equal(await db().get("SELECT 1 x FROM schema_migrations WHERE id='030_devapi'"), undefined);
  assert.deepEqual(await M.up(db()), ["030_devapi", ...later]);
  const src = require("fs").readFileSync(require.resolve("../migrations/030_devapi.js"), "utf8").split("async up")[1].split("async down")[0];
  assert.ok(!/DROP |ALTER |DELETE FROM/i.test(src));
});

test("helpers: scopes, PKCE, signature, backoff, URL policy, rate window, openapi", () => {
  assert.deepEqual(L.parseScopes("write:posts read bogus"), ["read", "write:posts"]);
  assert.deepEqual(L.parseScopes("bot read", L.USER_SCOPES), ["read"]);
  const v = crypto.randomBytes(40).toString("base64url"), ch = L.pkceChallenge(v);
  assert.ok(L.pkceOk(v, ch)); assert.ok(!L.pkceOk(v + "x", ch)); assert.ok(!L.pkceOk(v, ch, "plain")); assert.ok(!L.pkceOk("short", L.pkceChallenge("short")));
  const ts = Math.floor(Date.now() / 1000), sig = L.sign("s3", ts, "{}");
  assert.ok(L.verifySignature("s3", `t=${ts},v1=${sig}`, "{}")); assert.ok(!L.verifySignature("s3", `t=${ts},v1=${sig}`, "{ }")); assert.ok(!L.verifySignature("s3", `t=${ts - 900},v1=${L.sign("s3", ts - 900, "{}")}`, "{}"));
  assert.deepEqual([1, 2, 3].map((n) => L.backoff(n, 30e3)), [30e3, 120e3, 480e3]); assert.equal(L.backoff(20), 6 * 3600e3);
  for (const bad of ["http://example.com/h", "https://127.0.0.1/h", "https://10.0.0.5/h", "https://169.254.169.254/x", "https://localhost/x", "https://[::1]/x", "javascript:alert(1)", "https://u:p@example.com/"]) assert.equal(L.checkUrl(bad), null, bad);
  assert.ok(L.checkUrl("https://example.com/hook")); assert.ok(L.checkUrl("myapp://cb", { allowCustomScheme: true })); assert.ok(L.checkUrl("http://127.0.0.1:9/cb", { allowCustomScheme: true })); assert.equal(L.checkUrl("javascript:x", { allowCustomScheme: true }), null);
  const w = new L.RateWindow(1000); assert.ok(w.hit("k", 2, 0).ok); assert.equal(w.hit("k", 2, 1).remaining, 0); assert.ok(!w.hit("k", 2, 2).ok); assert.ok(w.hit("k", 2, 1500).ok);
  const d = L.openapi([{ id: "x", method: "GET", path: "/api/v1/a/:id", summary: "s", scope: "read", auth: "token" }], { version: "t" });
  assert.equal(d.openapi, "3.0.3"); assert.ok(d.paths["/api/v1/a/{id}"].get.parameters.some((p) => p.name === "id" && p.in === "path"));
});

let app, secret, key;
const P = {};
test("portal: create app (secret shown once, hashed), keys, rotate, validation", async () => {
  const bad = await owner.req("POST", "/api/dev/apps", { name: "تطبيقي", redirectUris: ["javascript:alert(1)"] });
  assert.equal(bad.status, 400);
  const r = await owner.req("POST", "/api/dev/apps", { name: "تطبيقي", description: "تجربة", redirectUris: ["https://client.example/cb", "myapp://cb"], scopes: ["read", "profile", "write:posts", "bot"] });
  assert.equal(r.status, 200, r.error); app = r.app; secret = r.clientSecret;
  assert.ok(secret.startsWith("mps_")); assert.deepEqual(app.scopes, ["read", "profile", "write:posts"]); // bot is never a requestable user scope
  const row = await db().get("SELECT * FROM devapi_apps WHERE id=$1", [app.id]);
  assert.notEqual(row.secret_hash, secret); assert.equal(row.secret_hash, L.sha(secret)); assert.ok(!JSON.stringify(row).includes(secret));
  const again = await owner.req("GET", "/api/dev/apps/" + app.id);
  assert.ok(!JSON.stringify(again).includes(secret)); assert.ok(again.app.secretHint.endsWith(secret.slice(-4)));
  assert.equal((await sara.req("GET", "/api/dev/apps/" + app.id)).status, 404); // not hers
  const k = await owner.req("POST", `/api/dev/apps/${app.id}/keys`, { name: "قراءة", scopes: ["read", "profile"] });
  assert.equal(k.status, 200, k.error); key = k.key; assert.ok(key.startsWith("mpk_"));
  assert.equal((await db().get("SELECT key_hash FROM devapi_keys WHERE id=$1", [k.id])).key_hash, L.sha(key));
  const me = await call("GET", "/api/v1/me", { token: key });
  assert.equal(me.status, 200, me.error); assert.equal(me.user.handle, "dv_owner"); assert.ok(!("password_hash" in me.user));
  const rot = await owner.req("POST", `/api/dev/keys/${k.id}/rotate`);
  assert.equal((await call("GET", "/api/v1/me", { token: key })).status, 401); key = rot.key;
  assert.equal((await call("GET", "/api/v1/me", { token: key })).status, 200);
  const k2 = await owner.req("POST", `/api/dev/apps/${app.id}/keys`, { name: "x" });
  assert.equal((await owner.req("DELETE", "/api/dev/keys/" + k2.id)).status, 200);
  assert.equal((await call("GET", "/api/v1/posts", { token: k2.key })).status, 401);
  // CSRF: portal routes still require the header; v1 does not take the cookie at all
  const noHdr = await owner.req("POST", "/api/dev/apps", { name: "x" }, { "X-Requested-With": "" });
  assert.equal(noHdr.status, 403);
  const cookieOnly = await fetch(H.base + "/api/v1/me", { headers: { Cookie: owner.cookie } });
  assert.equal(cookieOnly.status, 401);
});

test("v1 reads are public-only (anonymous viewer), even with a write-scoped token", async () => {
  H.app.ctx.rl.w.clear();
  const priv = await owner.req("POST", "/api/communities", { name: "مجتمع خاص جداً", type: "private" });
  const pubc = await owner.req("POST", "/api/communities", { name: "مجتمع المطورين العام", type: "public" });
  assert.equal(priv.status, 200, priv.error); P.privC = priv.community.id; P.pubC = pubc.community.id;
  P.pub = await post(sara, "منشور عام عن البرمجة #برمجة");
  P.fol = await post(sara, "للمتابعين فقط سر", { visibility: "followers" });
  P.inPriv = await post(owner, "داخل مجتمع خاص سر", { community: P.privC });
  P.inPub = await post(owner, "داخل المجتمع العام", { community: P.pubC });
  await db().run("UPDATE posts SET data=$1 WHERE id=$2", [JSON.stringify({ paid: { price: 1 } }), P.paid = await post(bob, "منشور مدفوع سر")]);
  const all = await call("GET", "/api/v1/posts?limit=50", { token: key });
  assert.equal(all.status, 200, all.error);
  const ids = all.items.map((p) => p.id);
  assert.ok(ids.includes(P.pub) && ids.includes(P.inPub));
  for (const x of [P.fol, P.inPriv, P.paid]) assert.ok(!ids.includes(x), x);
  assert.ok(!JSON.stringify(all).includes("سر"));
  for (const x of [P.fol, P.inPriv, P.paid]) assert.equal((await call("GET", "/api/v1/posts/" + x, { token: key })).status, 404);
  assert.equal((await call("GET", `/api/v1/communities/${P.privC}`, { token: key })).status, 404);
  assert.equal((await call("GET", `/api/v1/communities/${P.privC}/posts`, { token: key })).status, 404);
  const cl = await call("GET", "/api/v1/communities?limit=50"); assert.ok(cl.items.every((c) => c.id !== P.privC));
  const cp = await call("GET", `/api/v1/communities/${P.pubC}/posts`); assert.deepEqual(cp.items.map((p) => p.id), [P.inPub]);
  const tag = await call("GET", "/api/v1/posts?tag=برمجة"); assert.ok(tag.items.some((p) => p.id === P.pub));
  const u = await call("GET", "/api/v1/users/dv_sara"); assert.equal(u.status, 200); assert.equal(u.user.handle, "dv_sara");
  await db().run("UPDATE users SET private=1 WHERE id=$1", [bob.id]);
  assert.equal((await call("GET", "/api/v1/users/dv_bob")).status, 404);
  assert.equal((await call("GET", "/api/v1/users/dv_bob/posts")).status, 404);
  await db().run("UPDATE users SET private=0 WHERE id=$1", [bob.id]);
  // no messaging / E2EE surface exists on the API at all
  const spec = await call("GET", "/api/v1/openapi.json");
  assert.ok(!Object.keys(spec.paths).some((p) => /message|chat|e2ee|dm/i.test(p)));
  assert.equal((await call("GET", "/api/v1/messages", { token: key })).status, 404);
});

test("OpenAPI is generated from the route definitions", async () => {
  const s = await call("GET", "/api/v1/openapi.json");
  assert.equal(s.status, 200); assert.equal(s.openapi, "3.0.3");
  const want = svc().defs.map((d) => [d.path.replace(/:(\w+)/g, "{$1}"), d.method.toLowerCase()]);
  for (const [p, m] of want) assert.ok(s.paths[p]?.[m], p + " " + m);
  assert.equal(s.paths["/api/v1/posts"].post["x-scope"], "write:posts");
  assert.ok(s.components.securitySchemes.oauth2.flows.authorizationCode.scopes["write:posts"]);
  assert.ok(s["x-webhook-events"]["bot.command"]);
});

test("scopes and per-key rate limits", async () => {
  const w = await call("POST", "/api/v1/posts", { token: key, body: { text: "من مفتاح قراءة" } });
  assert.equal(w.status, 403); assert.equal(w.code, "insufficient_scope");
  assert.equal((await call("GET", "/api/v1/me")).status, 401);
  assert.equal((await call("GET", "/api/v1/posts", { token: "mpk_nope" })).status, 401);
  const k = await owner.req("POST", `/api/dev/apps/${app.id}/keys`, { name: "بطيء", rateLimit: 3 });
  const codes = []; let last;
  for (let i = 0; i < 4; i++) { last = await call("GET", "/api/v1/posts?limit=1", { token: k.key }); codes.push(last.status); }
  assert.deepEqual(codes, [200, 200, 200, 429]);
  assert.equal(last.headers.get("x-ratelimit-limit"), "3"); assert.equal(last.headers.get("x-ratelimit-remaining"), "0"); assert.ok(+last.headers.get("retry-after") >= 1);
  assert.equal((await call("GET", "/api/v1/posts?limit=1", { token: key })).status, 200); // other keys unaffected
  const pre = await fetch(H.base + "/api/v1/posts", { method: "OPTIONS" });
  assert.equal(pre.status, 200); assert.equal(pre.headers.get("access-control-allow-origin"), "*"); assert.match(pre.headers.get("access-control-allow-headers"), /Authorization/);
});

let access, refresh;
test("OAuth authorization code + PKCE with consent", async () => {
  const verifier = crypto.randomBytes(48).toString("base64url"), challenge = L.pkceChallenge(verifier);
  const q = new URLSearchParams({ client_id: app.id, redirect_uri: "https://client.example/cb", response_type: "code", scope: "read write:posts bot", state: "st8", code_challenge: challenge, code_challenge_method: "S256" });
  const redir = await fetch(H.base + "/oauth/authorize?" + q, { redirect: "manual" });
  assert.equal(redir.status, 302); assert.ok(redir.headers.get("location").startsWith("/#/oauth?client_id="));
  assert.equal((await call("GET", "/api/oauth/authorize?" + q)).status, 401);
  const info = await sara.req("GET", "/api/oauth/authorize?" + q);
  assert.equal(info.status, 200, info.error); assert.deepEqual(info.scopes.map((s) => s.scope), ["read", "write:posts"]); assert.equal(info.host, "client.example");
  const evil = new URLSearchParams(q); evil.set("redirect_uri", "https://evil.example/cb");
  assert.equal((await sara.req("GET", "/api/oauth/authorize?" + evil)).code, "invalid_redirect_uri");
  const noPkce = new URLSearchParams(q); noPkce.delete("code_challenge");
  assert.equal((await sara.req("GET", "/api/oauth/authorize?" + noPkce)).code, "invalid_request");
  const deny = await sara.req("POST", "/api/oauth/authorize", { ...Object.fromEntries(q), decision: "deny" });
  assert.match(deny.redirect, /error=access_denied/); assert.match(deny.redirect, /state=st8/);
  const ok = await sara.req("POST", "/api/oauth/authorize", { ...Object.fromEntries(q), decision: "allow" });
  const code = new URL(ok.redirect).searchParams.get("code"); assert.ok(code);
  assert.equal((await call("POST", "/api/oauth/token", { form: { grant_type: "authorization_code", client_id: app.id, code, redirect_uri: "https://client.example/cb", code_verifier: "x".repeat(43) } })).code, "invalid_grant");
  const ok2 = await sara.req("POST", "/api/oauth/authorize", { ...Object.fromEntries(q), decision: "allow" });
  const code2 = new URL(ok2.redirect).searchParams.get("code");
  const tok = await call("POST", "/api/oauth/token", { form: { grant_type: "authorization_code", client_id: app.id, code: code2, redirect_uri: "https://client.example/cb", code_verifier: verifier } });
  assert.equal(tok.status, 200, tok.error); assert.equal(tok.token_type, "Bearer"); assert.equal(tok.scope, "read write:posts");
  access = tok.access_token; refresh = tok.refresh_token;
  const reuse = await call("POST", "/api/oauth/token", { body: { grant_type: "authorization_code", client_id: app.id, code: code2, redirect_uri: "https://client.example/cb", code_verifier: verifier } });
  assert.equal(reuse.code, "invalid_grant");
  assert.equal((await call("GET", "/api/v1/posts?limit=1", { token: access })).status, 401); // code reuse revoked the tokens it issued
  // fresh grant again for the rest
  const ok3 = await sara.req("POST", "/api/oauth/authorize", { ...Object.fromEntries(q), decision: "allow" });
  const t3 = await call("POST", "/api/oauth/token", { form: { grant_type: "authorization_code", client_id: app.id, client_secret: secret, code: new URL(ok3.redirect).searchParams.get("code"), redirect_uri: "https://client.example/cb", code_verifier: verifier } });
  assert.equal(t3.status, 200, t3.error); access = t3.access_token; refresh = t3.refresh_token;
  assert.equal((await call("POST", "/api/oauth/token", { form: { grant_type: "authorization_code", client_id: app.id, client_secret: "wrong", code: "x" } })).status, 401);
  assert.equal((await call("GET", "/api/v1/me", { token: access })).status, 403); // no profile scope
  const row = await db().get("SELECT * FROM devapi_tokens WHERE kind='access' ORDER BY created_at DESC LIMIT 1");
  assert.ok(!JSON.stringify(row).includes(access));
});

test("posting as the user: public only; refresh rotation + reuse detection; user revocation", async () => {
  const p = await call("POST", "/api/v1/posts", { token: access, body: { text: "منشور من تطبيق خارجي", visibility: "followers" } });
  assert.equal(p.status, 200, p.error); assert.equal(p.post.author.handle, "dv_sara");
  assert.equal((await db().get("SELECT visibility FROM posts WHERE id=$1", [p.post.id])).visibility, "public");
  assert.equal((await call("POST", "/api/v1/posts", { token: access, body: { text: "في الخاص", community: P.privC } })).status, 404);
  const c = await call("POST", `/api/v1/posts/${P.pub}/comments`, { token: access, body: { text: "تعليق عبر الواجهة" } });
  assert.equal(c.status, 200, c.error);
  assert.equal((await call("POST", `/api/v1/posts/${P.fol}/comments`, { token: access, body: { text: "x" } })).status, 404);
  const r1 = await call("POST", "/api/oauth/token", { form: { grant_type: "refresh_token", client_id: app.id, refresh_token: refresh } });
  assert.equal(r1.status, 200, r1.error); assert.notEqual(r1.refresh_token, refresh);
  const replay = await call("POST", "/api/oauth/token", { form: { grant_type: "refresh_token", client_id: app.id, refresh_token: refresh } });
  assert.equal(replay.code, "invalid_grant");
  assert.equal((await call("GET", "/api/v1/posts?limit=1", { token: r1.access_token })).status, 401); // whole family revoked
  const conns = await sara.req("GET", "/api/dev/connections"); assert.equal(conns.items[0].app, app.id);
  assert.equal((await sara.req("DELETE", "/api/dev/connections/" + app.id)).status, 200);
  assert.equal((await sara.req("GET", "/api/dev/connections")).items.length, 0);
});

test("webhooks: signed, retried with backoff, logged, manual retry", async () => {
  const bad = await owner.req("POST", `/api/dev/apps/${app.id}/webhooks`, { url: "ftp://x", events: ["post.created"] }); assert.equal(bad.status, 400);
  const w = await owner.req("POST", `/api/dev/apps/${app.id}/webhooks`, { url: `http://127.0.0.1:${hook.address().port}/h`, events: ["post.created", "comment.created"] });
  assert.equal(w.status, 200, w.error); const whsec = w.secret;
  hits = []; hookMode = "ok";
  const pid = await post(bob, "منشور عام للويبهوك");
  await post(bob, "منشور متابعين لا يُرسل", { visibility: "followers" });
  const h = await until(() => hits.find((x) => JSON.parse(x.body).data?.post?.id === pid));
  assert.ok(h, "delivered");
  assert.equal(h.headers["x-mujtama-event"], "post.created");
  assert.ok(L.verifySignature(whsec, h.headers["x-mujtama-signature"], h.body));
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(!hits.some((x) => x.body.includes("لا يُرسل")));
  hookMode = "fail"; hits = [];
  await post(bob, "منشور سيفشل تسليمه");
  const d = await until(async () => db().get("SELECT * FROM devapi_deliveries WHERE body LIKE '%سيفشل%' AND attempts>=1"));
  assert.equal(d.status, "pending"); assert.equal(d.last_code, 500); assert.ok(d.next_at);
  for (let i = 0; i < 8; i++) { await db().run("UPDATE devapi_deliveries SET next_at=$1 WHERE id=$2 AND status='pending'", ["2000-01-01T00:00:00.000Z", d.id]); await svc().deliverDue(); }
  const f = await db().get("SELECT * FROM devapi_deliveries WHERE id=$1", [d.id]);
  assert.equal(f.status, "failed"); assert.equal(f.attempts, svc().cfg.maxAttempts);
  const log = await owner.req("GET", `/api/dev/apps/${app.id}/deliveries`);
  assert.ok(log.items.some((x) => x.id === d.id && x.status === "failed" && x.lastError === "HTTP 500"));
  hookMode = "ok";
  assert.equal((await owner.req("POST", `/api/dev/deliveries/${d.id}/retry`)).status, 200);
  assert.ok(await until(async () => (await db().get("SELECT status FROM devapi_deliveries WHERE id=$1", [d.id])).status === "ok"));
  assert.equal((await sara.req("GET", `/api/dev/apps/${app.id}/deliveries`)).status, 404);
});

test("bots: public communities only, client_credentials, slash commands + mentions, bot posts", async () => {
  const bad = await owner.req("POST", `/api/dev/apps/${app.id}/bot`, { handle: "helper" }); assert.equal(bad.status, 400);
  const b = await owner.req("POST", `/api/dev/apps/${app.id}/bot`, { handle: "helperbot", name: "المساعد" });
  assert.equal(b.status, 200, b.error);
  assert.equal((await db().get("SELECT role, password_hash FROM users WHERE id=$1", [b.bot.id])).role, "bot");
  await owner.req("PATCH", "/api/dev/apps/" + app.id, { commands: [{ name: "/weather", description: "الطقس" }, { name: "bad name!" }] });
  assert.deepEqual((await owner.req("GET", "/api/dev/apps/" + app.id)).app.commands.map((c) => c.name), ["weather"]);
  assert.equal((await owner.req("POST", `/api/dev/apps/${app.id}/installs`, { community: P.privC })).code, "private_community");
  assert.equal((await sara.req("POST", `/api/dev/apps/${app.id}/installs`, { community: P.pubC })).status, 403);
  assert.equal((await owner.req("POST", `/api/dev/apps/${app.id}/installs`, { community: P.pubC })).status, 200);
  const w = await owner.req("POST", `/api/dev/apps/${app.id}/webhooks`, { url: `http://127.0.0.1:${hook.address().port}/bot`, events: ["bot.command", "bot.mention"] });
  assert.equal(w.status, 200);
  H.app.ctx.rl.w.clear();
  assert.equal((await sara.req("POST", `/api/communities/${P.pubC}/join`)).status < 500, true);
  hits = [];
  await post(owner, "/weather جدة", { community: P.pubC });
  await post(owner, "مرحبا @helperbot كيف الحال", { community: P.pubC });
  await post(owner, "/weather سر خاص", { community: P.privC });
  const cmd = await until(() => hits.find((x) => x.headers["x-mujtama-event"] === "bot.command"));
  assert.ok(cmd); const cd = JSON.parse(cmd.body).data; assert.equal(cd.command, "weather"); assert.equal(cd.args, "جدة"); assert.equal(cd.community, P.pubC);
  assert.ok(await until(() => hits.find((x) => x.headers["x-mujtama-event"] === "bot.mention")));
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(!hits.some((x) => x.body.includes("سر خاص")));
  const noSec = await call("POST", "/api/oauth/token", { form: { grant_type: "client_credentials", client_id: app.id } }); assert.equal(noSec.status, 401);
  const bt = await call("POST", "/api/oauth/token", { form: { grant_type: "client_credentials", client_id: app.id, client_secret: secret } });
  assert.equal(bt.status, 200, bt.error); assert.equal(bt.refresh_token, undefined);
  assert.equal((await call("POST", "/api/v1/posts", { token: bt.access_token, body: { text: "رد البوت بلا مجتمع" } })).code, "bot_not_installed");
  const bp = await call("POST", "/api/v1/posts", { token: bt.access_token, body: { text: "الطقس في جدة مشمس", community: P.pubC } });
  assert.equal(bp.status, 200, bp.error); assert.equal(bp.post.author.bot, true);
  const rot = await owner.req("POST", `/api/dev/apps/${app.id}/secret`);
  assert.equal((await call("POST", "/api/oauth/token", { form: { grant_type: "client_credentials", client_id: app.id, client_secret: secret } })).status, 401);
  secret = rot.clientSecret;
});

test("admin suspends an app: its keys and tokens stop working", async () => {
  assert.equal((await owner.req("POST", `/api/admin/devapi/apps/${app.id}`, { status: "suspended" })).status, 403);
  // first registered user is admin
  const adminRow = await db().get("SELECT role FROM users WHERE id=$1", [admin.id]); assert.equal(adminRow.role, "admin");
  assert.equal((await admin.req("POST", `/api/admin/devapi/apps/${app.id}`, { status: "suspended" })).status, 200);
  assert.equal((await call("GET", "/api/v1/posts", { token: key })).status, 401);
  assert.equal((await admin.req("GET", "/api/dev/apps?all=1")).apps.find((a) => a.id === app.id).status, "suspended");
  assert.equal((await admin.req("GET", "/api/admin/devapi/stats")).status, 200);
  await admin.req("POST", `/api/admin/devapi/apps/${app.id}`, { status: "active" });
  assert.equal((await call("GET", "/api/v1/posts", { token: key })).status, 200);
  assert.equal((await owner.req("DELETE", "/api/dev/apps/" + app.id)).status, 200);
  assert.equal((await call("GET", "/api/v1/posts", { token: key })).status, 401);
});
