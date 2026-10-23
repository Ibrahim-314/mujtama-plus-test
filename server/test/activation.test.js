/* Phase 52 — provider activation at zero cost. Covers: migration 035 additive down/up, VAPID auto policy (production included),
 * push end-to-end (subscribe → /api/push/test → a local push endpoint receives an aes128gcm body with a VAPID header that
 * decrypts to the test payload), SMTP turnkey (form → sealed storage, password never returned, hot swap, test send to a local
 * SMTP server, template previews, clear → in-app fallback), translation turnkey (DeepL paid key refused, LibreTranslate test
 * before save, save → active via translate service, clear), unified checklist + /status components, admin-only, and
 * phase 57 change/renew answering 501 while Pi payments are off. */
const test = require("node:test"), assert = require("node:assert");
const http = require("node:http"), net = require("node:net"), crypto = require("node:crypto");
const { boot } = require("./helpers");
const WP = require("../lib/webpush"), P = require("../lib/providers");

let H, admin, user, pushSrv, smtpSrv, ltSrv;
const got = { push: [], mail: [], lt: [] };
const db = () => H.app.ctx.db;
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

test.before(async () => {
  pushSrv = http.createServer((req, res) => { const ch = []; req.on("data", (c) => ch.push(c)); req.on("end", () => { got.push.push({ headers: req.headers, body: Buffer.concat(ch) }); res.writeHead(201); res.end(); }); });
  smtpSrv = net.createServer((s) => {
    let data = false, buf = "", msg = ""; s.write("220 fake ESMTP\r\n");
    s.on("data", (d) => { buf += d.toString(); let i;
      while ((i = buf.indexOf("\r\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === ".") { data = false; got.mail.push(msg); s.write("250 queued\r\n"); } else msg += line + "\n"; continue; }
        if (/^EHLO/.test(line)) s.write("250-fake\r\n250 AUTH PLAIN\r\n"); else if (/^AUTH/.test(line)) { got.auth = Buffer.from(line.split(" ")[2], "base64").toString(); s.write("235 ok\r\n"); }
        else if (/^DATA/.test(line)) { data = true; msg = ""; s.write("354 go\r\n"); } else if (/^QUIT/.test(line)) { s.write("221 bye\r\n"); s.end(); } else s.write("250 ok\r\n"); } });
  });
  ltSrv = http.createServer((req, res) => { const ch = []; req.on("data", (c) => ch.push(c)); req.on("end", () => { const b = JSON.parse(Buffer.concat(ch).toString() || "{}"); got.lt.push(b); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ translatedText: "[" + b.target + "] " + b.q })); }); });
  for (const s of [pushSrv, smtpSrv, ltSrv]) s.port = await listen(s);
  H = await boot({ queuePollMs: 50 });
  const mk = async (handle) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; return c; };
  admin = await mk("act_admin"); user = await mk("act_user");
  await db().run("UPDATE users SET role='admin', email='admin@example.com', email_verified_at=$1 WHERE id=$2", [new Date().toISOString(), admin.id]);
});
test.after(async () => { await H.app.close(); for (const s of [pushSrv, smtpSrv, ltSrv]) s.close(); });

test("migration 035: down/up reversible and additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '035_providers' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "035_providers"]);
  await assert.rejects(() => db().get("SELECT 1 FROM provider_settings"));
  assert.deepEqual(await mig.up(db()), ["035_providers", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
});

test("VAPID policy: auto in production unless VAPID_ENV_ONLY=1; pair generated and stored at boot", async () => {
  assert.equal(P.vapidPolicy({ NODE_ENV: "production" }), "auto");
  assert.equal(P.vapidPolicy({ NODE_ENV: "production", VAPID_ENV_ONLY: "1" }), "env-only");
  assert.ok(await db().get("SELECT 1 x FROM notify_keys WHERE name='vapid'"));
  const cfg = await user.req("GET", "/api/pwa/config"); assert.equal(cfg.push.enabled, true); assert.equal(cfg.push.source, "stored");
  const st = await user.req("GET", "/api/providers/status"); assert.equal(st.push, true); assert.equal(st.email, false); assert.equal(st.fallback, "inapp");
  // sealing round-trip
  const k = crypto.randomBytes(32).toString("base64url"); assert.equal(P.unseal(k, P.seal(k, "سر")), "سر"); assert.equal(P.unseal(crypto.randomBytes(32).toString("base64url"), P.seal(k, "x")), null);
});

test("push end-to-end: subscribe → test push → endpoint receives a VAPID-signed aes128gcm body that decrypts", async () => {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const keys = { p256dh: WP.b64u(ecdh.getPublicKey()), auth: WP.b64u(crypto.randomBytes(16)) };
  const endpoint = `http://127.0.0.1:${pushSrv.port}/push/abc`;
  const s = await admin.req("POST", "/api/push/subscribe", { endpoint, keys }); assert.equal(s.status, 200, s.error);
  const t = await admin.req("POST", "/api/push/test"); assert.equal(t.status, 200, t.error); assert.equal(t.devices, 1);
  assert.ok(await until(() => got.push.length > 0), "push endpoint never called");
  const r = got.push[0]; const vapid = await H.app.ctx.services.notify.vapid();
  assert.match(r.headers.authorization, new RegExp("^vapid t=.+, k=" + vapid.publicKey + "$"));
  assert.equal(r.headers["content-encoding"], "aes128gcm");
  const payload = JSON.parse(WP.decrypt(r.body, { uaPrivateKey: WP.b64u(ecdh.getPrivateKey()), auth: keys.auth }).toString());
  assert.equal(payload.kind, "test");
  const ps = await admin.req("GET", "/api/admin/activation/push"); assert.equal(ps.on, true); assert.equal(ps.subscriptions, 1);
});

test("email: admin-only, form → sealed storage, hot swap, test send, previews, clear → in-app fallback", async () => {
  assert.equal((await user.req("PUT", "/api/admin/activation/email", { host: "127.0.0.1" })).status, 403);
  assert.equal((await admin.req("POST", "/api/admin/activation/email/test", {})).code, "not_configured");
  assert.equal((await admin.req("PUT", "/api/admin/activation/email", { host: "bad host!" })).code, "smtp_invalid");
  assert.equal((await admin.req("PUT", "/api/admin/activation/email", { host: "127.0.0.1", port: smtpSrv.port, from: "bad<" })).code, "from_invalid");
  const s = await admin.req("PUT", "/api/admin/activation/email", { host: "127.0.0.1", port: smtpSrv.port, user: "me@example.com", pass: "app-pass-123", from: "مجتمع بلس <me@example.com>" });
  assert.equal(s.status, 200, s.error); assert.equal(s.enabled, true); assert.equal(s.source, "db"); assert.equal(s.stored.passSet, true);
  assert.ok(!JSON.stringify(s).includes("app-pass-123"));
  const raw = (await db().get("SELECT value FROM provider_settings WHERE name='smtp'")).value; assert.ok(!raw.includes("app-pass-123"), "password stored unsealed");
  // saving again without a password keeps the old one
  const s2 = await admin.req("PUT", "/api/admin/activation/email", { host: "127.0.0.1", port: smtpSrv.port, user: "me@example.com", from: "مجتمع بلس <me@example.com>" }); assert.equal(s2.stored.passSet, true);
  const t = await admin.req("POST", "/api/admin/activation/email/test", {}); assert.equal(t.ok, true, t.error); assert.equal(t.to, "admin@example.com");
  assert.equal(got.auth, "\0me@example.com\0app-pass-123"); assert.ok(got.mail[0].includes("Subject: =?UTF-8?B?"));
  assert.equal((await admin.req("POST", "/api/admin/activation/email/test", {})).code, "slow_down");
  assert.equal((await user.req("GET", "/api/providers/status")).email, true);
  for (const tpl of ["test", "verify", "reset", "security", "notification", "weekly"]) { const p = await admin.req("GET", "/api/admin/activation/email/preview/" + tpl); assert.equal(p.status, 200, tpl); assert.ok(p.subject && p.html.includes("dir=\"rtl\""), tpl); }
  const c = await admin.req("DELETE", "/api/admin/activation/email"); assert.equal(c.enabled, false);
  assert.equal((await user.req("GET", "/api/providers/status")).fallback, "inapp");
});

test("translation: DeepL paid refused, LibreTranslate test before save, save → active, clear", async () => {
  assert.equal((await admin.req("PUT", "/api/admin/activation/translate", { provider: "deepl", key: "abc-paid" })).code, "deepl_paid");
  assert.equal((await admin.req("PUT", "/api/admin/activation/translate", { provider: "google" })).code, "provider_invalid");
  assert.equal((await admin.req("POST", "/api/admin/activation/translate/test", {})).code, "not_configured");
  const url = `http://127.0.0.1:${ltSrv.port}`;
  const t = await admin.req("POST", "/api/admin/activation/translate/test", { provider: "libre", url, text: "مرحبا" }); assert.equal(t.ok, true, t.error); assert.equal(t.text, "[en] مرحبا");
  assert.equal(got.lt[0].source, "auto");
  const s = await admin.req("PUT", "/api/admin/activation/translate", { provider: "libre", url, key: "lt-key-1" }); assert.equal(s.status, 200, s.error);
  assert.equal(s.available, true); assert.equal(s.source, "db"); assert.equal(s.provider, "libre"); assert.equal(s.private, true); assert.equal(s.stored.keySet, true); assert.ok(!JSON.stringify(s).includes("lt-key-1"));
  const t2 = await admin.req("POST", "/api/admin/activation/translate/test", { target: "fr" }); assert.equal(t2.ok, true); assert.equal(t2.text, "[fr] مرحباً بكم في مجتمع بلس"); assert.equal(got.lt.at(-1).api_key, "lt-key-1");
  const c = await admin.req("GET", "/api/admin/activation"); assert.equal(c.active.translate, true); assert.equal(c.active.push, true);
  assert.deepEqual(c.groups.map((g) => g.id), ["pi", "push", "email", "translate"]); assert.ok(c.steps.email.length && c.steps.translate.length);
  assert.ok(c.items.find((i) => i.key === "pi_payments" && i.ok === false));
  await admin.req("DELETE", "/api/admin/activation/translate");
  assert.equal(H.app.ctx.services.translate.status().available, false);
});

test("/status lists push + translate; subscriptions answer 501 while Pi payments are off", async () => {
  await H.app.ctx.services.observability.checkComponents?.();
  const s = await user.req("GET", "/api/status/public"); assert.equal(s.status, 200);
  const ids = s.components.map((c) => c.id); assert.ok(ids.includes("push") && ids.includes("translate"));
  assert.equal(s.components.find((c) => c.id === "translate").state, "not_configured");
  assert.equal((await user.req("POST", "/api/subs/act_admin/renew", { tierId: "x" })).status, 501);
  assert.equal((await user.req("POST", "/api/subs/act_admin/change", { tierId: "x" })).status, 501);
});
