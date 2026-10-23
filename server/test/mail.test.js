/* Track 6 — email (Phase 29): account email + verification, password recovery, security alerts,
 * notification emails, weekly digest, RFC 8058 one-click unsubscribe (signed tokens), provider bounce
 * webhook → suppression list, SMTP 4xx retry with backoff / 5xx hard bounce, DKIM signature on every mail. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto"), net = require("node:net");
const { generateKeyPairSync } = crypto;
const { boot } = require("./helpers");
const DKIM = require("../lib/dkim");
const { createMailer } = require("../lib/mailer");

const keys = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const HOOK = "whsec_" + crypto.randomBytes(12).toString("hex");
let H, U;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const db = () => H.app.ctx.db;
const outbox = () => H.app.ctx.mailer.outbox;
const mk = async (handle, name) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; return c; };
async function until(fn, ms = 8000, label = "condition") { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(50); } throw new Error("timeout: " + label); }
const mailTo = (to, kind) => until(() => [...outbox()].reverse().find(m => m.to === to && (!kind || m.headers?.["X-Entity-Ref-ID"] === kind)), 8000, `mail ${kind} → ${to}`);
const linkIn = (m, re) => (m.text.match(re) || [])[0];
/** give a client a verified address through the real flow */
async function verifyEmail(c, email) {
  const r = await c.req("PUT", "/api/account/email", { email }); assert.equal(r.status, 200, r.error); assert.equal(r.verified, false);
  const m = await mailTo(email, "verify");
  const url = linkIn(m, /https?:\/\/\S+\/api\/email\/verify\?t=[\w-]+/); assert.ok(url, "verify link in text part");
  const res = await fetch(H.base + new URL(url).pathname + new URL(url).search, { redirect: "manual" });
  assert.equal(res.status, 302); assert.equal(res.headers.get("location"), "/#/emailprefs?verified=1");
  return { mail: m, url };
}
const hookPost = (body, sig = crypto.createHmac("sha256", HOOK).update(body).digest("hex")) => fetch(H.base + "/api/email/events", { method: "POST", headers: { "Content-Type": "application/json", ...(sig ? { "X-Webhook-Signature": "sha256=" + sig } : {}) }, body }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));

test.before(async () => {
  Object.assign(process.env, { SMTP_URL: "memory:", SMTP_FROM: "مجتمع بلس <no-reply@mujtama.plus>", DKIM_PRIVATE_KEY: keys.privateKey.replace(/\n/g, "\\n"), DKIM_SELECTOR: "mp2026", DKIM_DOMAIN: "mujtama.plus", MAIL_WEBHOOK_SECRET: HOOK, NOTIFY_EMAIL_DELAY_MS: "0" });
  H = await boot({ queuePollMs: 100 });
  U = await mk("mail_u", "وفاء");
});
test.after(async () => { await H.app.close(); for (const k of ["SMTP_URL", "SMTP_FROM", "DKIM_PRIVATE_KEY", "DKIM_SELECTOR", "DKIM_DOMAIN", "MAIL_WEBHOOK_SECRET"]) delete process.env[k]; });
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("account email: verification mail is DKIM-signed (verifies with the published key), link is single-use, duplicates refused", async () => {
  assert.equal(H.app.ctx.mailer.enabled, true); assert.deepEqual(H.app.ctx.mailer.dkim, { selector: "mp2026", domain: "mujtama.plus" });
  assert.equal((await U.req("PUT", "/api/account/email", { email: "not-an-email" })).status, 400);
  const { mail, url } = await verifyEmail(U, "Wafa@Example.com".toLowerCase());
  assert.match(mail.raw, /^DKIM-Signature: v=1;\s+a=rsa-sha256;\s+c=relaxed\/relaxed;\s+d=mujtama\.plus;\s+s=mp2026;/, "DKIM-Signature is the first header");
  assert.ok(DKIM.verify(mail.raw, keys.publicKey).ok, "DKIM verifies with the public key");
  const dns = DKIM.dnsRecord({ privateKey: keys.privateKey, selector: "mp2026", domain: "mujtama.plus" });
  assert.ok(DKIM.verify(mail.raw, crypto.createPublicKey({ key: Buffer.from(dns.value.split("p=")[1], "base64"), format: "der", type: "spki" })).ok, "…and with the DNS TXT record's key");
  assert.match(mail.raw, /^Message-ID: <[^@]+@mujtama\.plus>$/m);
  assert.match(mail.html, /dir="rtl"/); assert.match(mail.subject, /[\u0600-\u06FF]/, "Arabic subject");
  assert.ok(!/^List-Unsubscribe:/m.test(mail.raw), "transactional mail has no unsubscribe header");
  const again = await fetch(H.base + new URL(url).pathname + new URL(url).search, { redirect: "manual" }); assert.equal(again.headers.get("location"), "/#/emailprefs?verified=0", "token is single-use");
  const me = await U.req("GET", "/api/account/email"); assert.equal(me.verified, true); assert.equal(me.email, "wafa@example.com");
  const log = await db().get("SELECT * FROM email_log WHERE email=$1 AND kind='verify'", ["wafa@example.com"]); assert.equal(log.status, "sent"); assert.equal(log.message_id, mail.messageId);
  const X = await mk("mail_dup"); assert.equal((await X.req("PUT", "/api/account/email", { email: "wafa@example.com" })).status, 409);
  // changing a verified address needs the password, and alerts the OLD address
  assert.equal((await U.req("PUT", "/api/account/email", { email: "wafa2@example.com" })).status, 401);
  const ch = await U.req("PUT", "/api/account/email", { email: "wafa2@example.com", password: "secret123" }); assert.equal(ch.status, 200, ch.error);
  const alert = await mailTo("wafa@example.com", "security_email"); assert.ok(alert.text.includes("wafa2@example.com") || alert.html.includes("wafa2@example.com"));
  await verifyEmail(U, "wafa2@example.com");
  assert.ok(await until(() => db().get("SELECT id FROM notifications WHERE user_id=$1 AND kind='security_email'", [U.id])));
});

test("password recovery: same answer for unknown accounts, single-use reset token, sessions revoked, security mail + notification", async () => {
  const R = await mk("mail_reset", "رامي"); await verifyEmail(R, "rami@example.com");
  const n0 = outbox().length;
  const unknown = await new H.Client().req("POST", "/api/auth/forgot", { login: "nobody@example.com" });
  const known = await new H.Client().req("POST", "/api/auth/forgot", { login: "rami@example.com" });
  assert.equal(unknown.status, 200); assert.equal(unknown.message, known.message, "no account enumeration");
  const m = await mailTo("rami@example.com", "reset"); assert.equal(outbox().length, n0 + 1);
  assert.ok(DKIM.verify(m.raw, keys.publicKey).ok);
  const tok = decodeURIComponent((m.text.match(/reset\?t=([\w-]+)/) || [])[1] || ""); assert.ok(tok);
  assert.equal((await new H.Client().req("POST", "/api/auth/reset", { token: tok, password: "short" })).status, 400);
  assert.equal((await new H.Client().req("POST", "/api/auth/reset", { token: tok, password: "newpass123" })).ok, true);
  assert.equal((await new H.Client().req("POST", "/api/auth/reset", { token: tok, password: "another123" })).status, 400, "single-use");
  assert.equal((await R.req("GET", "/api/account/email")).status, 401, "old sessions revoked");
  const L = new H.Client(); H.app.ctx.rl.w.clear(); assert.equal((await L.req("POST", "/api/auth/login", { handle: "mail_reset", password: "newpass123" })).status, 200);
  await mailTo("rami@example.com", "security_password");
  assert.ok(await until(() => db().get("SELECT id FROM notifications WHERE user_id=$1 AND kind='security_password'", [R.id])));
  // change password while signed in: wrong current refused
  assert.equal((await L.req("POST", "/api/account/password", { current: "wrong", password: "x12345678" })).status, 401);
});

test("notification email: opt-in per kind, List-Unsubscribe + One-Click headers DKIM-signed, RFC 8058 GET confirms only, POST unsubscribes without CSRF header", async () => {
  const N = await mk("mail_notif", "نادية"), F = await mk("mail_follower", "فهد");
  await verifyEmail(N, "nadia@example.com");
  await F.req("PUT", `/api/follows/${N.id}`); await H.app.ctx.queue.drain(5000); await sleep(200);
  assert.ok(!outbox().some(m => m.to === "nadia@example.com" && m.headers?.["X-Entity-Ref-ID"] === "notify_follow"), "follow emails are off by default");
  const p = await N.req("PUT", "/api/email/prefs", { kinds: { follow: true } }); assert.equal(p.kinds.find(k => k.kind === "follow").email, true);
  await F.req("DELETE", `/api/follows/${N.id}`); await F.req("PUT", `/api/follows/${N.id}`);
  const m = await mailTo("nadia@example.com", "notify_follow");
  assert.match(m.text, /فهد بدأ بمتابعتك/);
  const lu = /^List-Unsubscribe: <([^>]+)>$/m.exec(m.raw); assert.ok(lu, "List-Unsubscribe header");
  assert.match(m.raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  const sig = /^DKIM-Signature:([\s\S]*?)(?=\r\n\S)/m.exec(m.raw)[1].replace(/\s+/g, "");
  const h = /h=([^;]+)/.exec(sig)[1].split(":"); for (const x of ["list-unsubscribe", "list-unsubscribe-post", "from", "subject"]) assert.ok(h.includes(x), "DKIM signs " + x);
  assert.ok(DKIM.verify(m.raw, keys.publicKey).ok);
  const u = new URL(lu[1]); assert.equal(u.pathname, "/api/email/unsubscribe");
  // GET (link scanners) shows a confirmation page and changes nothing
  const g = await fetch(H.base + u.pathname + u.search); assert.equal(g.status, 200); const page = await g.text();
  assert.match(page, /تأكيد إلغاء الاشتراك/); assert.match(page, /method="post"/); assert.match(g.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal((await N.req("GET", "/api/email/prefs")).kinds.find(k => k.kind === "follow").email, true, "GET must not unsubscribe");
  // the mail provider's one-click POST: form body, no cookie, no X-Requested-With
  const post = await fetch(H.base + u.pathname + u.search, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(post.status, 200); assert.deepEqual(await post.json(), { ok: true, category: "notify:follow" });
  assert.equal((await N.req("GET", "/api/email/prefs")).kinds.find(k => k.kind === "follow").email, false);
  // tampered / garbage tokens
  const [body, s] = u.searchParams.get("t").split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url")), c: "all" })).toString("base64url") + "." + s;
  assert.equal((await fetch(H.base + "/api/email/unsubscribe?t=" + forged, { method: "POST", body: "List-Unsubscribe=One-Click" })).status, 400);
  assert.equal((await fetch(H.base + "/api/email/unsubscribe?t=garbage")).status, 400);
  // global notification-email switch
  await N.req("PUT", "/api/email/prefs", { kinds: { follow: true }, notifyEmails: false });
  const before = outbox().length; await F.req("DELETE", `/api/follows/${N.id}`); await F.req("PUT", `/api/follows/${N.id}`); await H.app.ctx.queue.drain(5000); await sleep(200);
  assert.equal(outbox().slice(before).filter(x => x.to === "nadia@example.com").length, 0);
});

test("weekly digest: sent through the mail service with one-click unsubscribe; unsubscribing stops the next run", async () => {
  const W = await mk("mail_weekly", "وليد"); await verifyEmail(W, "walid@example.com");
  const auth = await mk("mail_author"); await auth.req("POST", "/api/posts", { text: "منشور ضمن النشرة الأسبوعية عن تطوير تطبيقات Pi" });
  assert.equal((await W.req("PUT", "/api/email/prefs", { weekly: true })).weekly, true);
  const r = await H.app.ctx.services.summaries.weeklyJob(); assert.ok(r && !r.skipped, JSON.stringify(r));
  const m = await mailTo("walid@example.com", "weekly");
  assert.ok(DKIM.verify(m.raw, keys.publicKey).ok); assert.match(m.raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m); assert.match(m.html, /dir="rtl"/);
  const u = new URL(/^List-Unsubscribe: <([^>]+)>$/m.exec(m.raw)[1]);
  const res = await fetch(H.base + u.pathname + u.search, { method: "POST", headers: { Accept: "text/html" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(res.status, 200); assert.match(await res.text(), /تم إلغاء الاشتراك/);
  assert.equal((await W.req("GET", "/api/email/prefs")).weekly, false);
  await db().run("UPDATE digest_settings SET last_weekly=NULL WHERE user_id=$1", [W.id]);
  const n = outbox().length; await H.app.ctx.services.summaries.weeklyJob();
  assert.equal(outbox().slice(n).filter(x => x.to === "walid@example.com").length, 0);
  assert.equal((await new H.Client().req("PUT", "/api/email/prefs", { weekly: true })).status, 401);
  const NoMail = await mk("mail_nomail"); assert.equal((await NoMail.req("PUT", "/api/email/prefs", { weekly: true })).status, 400, "needs a verified address");
});

test("bounce webhook: signature required; SES / Postmark / SendGrid / SNS payloads → log status + suppression; suppressed addresses are skipped", async () => {
  const B = await mk("mail_bounce", "بسمة"); const { mail } = await verifyEmail(B, "basma@example.com");
  const body = JSON.stringify({ notificationType: "Bounce", mail: { messageId: mail.messageId.replace(/[<>]/g, "") }, bounce: { bounceType: "Permanent", bounceSubType: "General", bouncedRecipients: [{ emailAddress: "basma@example.com", diagnosticCode: "550 5.1.1 user unknown" }] } });
  assert.equal((await hookPost(body, null)).status, 403, "unsigned");
  assert.equal((await hookPost(body, "0".repeat(64))).status, 403, "bad signature");
  assert.equal((await fetch(H.base + "/api/email/events?token=wrong", { method: "POST", body })).status, 403);
  const ok = await hookPost(body); assert.equal(ok.status, 200, ok.error); assert.deepEqual(ok.statuses, ["bounced"]);
  assert.equal((await db().get("SELECT reason FROM email_suppressions WHERE email='basma@example.com'")).reason, "hard_bounce");
  assert.equal((await db().get("SELECT status FROM email_log WHERE message_id=$1", [mail.messageId])).status, "bounced", "matched by provider message id");
  assert.equal((await B.req("GET", "/api/account/email")).suppressed, "hard_bounce");
  // hard bounce blocks even transactional mail
  const n = outbox().length; await new H.Client().req("POST", "/api/auth/forgot", { login: "basma@example.com" }); await H.app.ctx.queue.drain(5000);
  assert.equal(outbox().length, n); assert.ok(await db().get("SELECT id FROM email_log WHERE email='basma@example.com' AND kind='reset' AND status='suppressed'"));
  // SendGrid spam report → complaint: notification mail blocked, password recovery still delivered
  const C = await mk("mail_complain"); await verifyEmail(C, "chloe@example.com");
  assert.deepEqual((await hookPost(JSON.stringify([{ event: "spamreport", email: "chloe@example.com" }]))).statuses, ["complained"]);
  const r1 = await H.app.ctx.services.mail.sendNow({ to: "chloe@example.com", kind: "notify_follow", subject: "x", html: "x", text: "x" }); assert.equal(r1.status, "suppressed");
  const r2 = await H.app.ctx.services.mail.sendNow({ to: "chloe@example.com", kind: "reset", subject: "x", html: "x", text: "x", transactional: true }); assert.equal(r2.status, "sent");
  // resubscribe clears a complaint (user's explicit choice)
  assert.equal((await C.req("PUT", "/api/email/prefs", { resubscribe: true })).suppressed, null);
  // Postmark soft bounces: five → soft_bounce suppression; a delivery clears a pending soft count
  for (let i = 0; i < 5; i++) await hookPost(JSON.stringify({ RecordType: "Bounce", Type: "SoftBounce", Email: "soft@example.com", MessageID: "pm-" + i }));
  assert.equal((await db().get("SELECT reason, soft_count FROM email_suppressions WHERE email='soft@example.com'")).reason, "soft_bounce");
  await hookPost(JSON.stringify({ RecordType: "Bounce", Type: "SoftBounce", Email: "soft2@example.com", MessageID: "pm-x" }));
  await hookPost(JSON.stringify({ RecordType: "Delivery", Email: "soft2@example.com", MessageID: "pm-y" }));
  assert.equal(await db().get("SELECT * FROM email_suppressions WHERE email='soft2@example.com'"), undefined);
  // SNS envelope around an SES complaint
  const sns = JSON.stringify({ Type: "Notification", Message: JSON.stringify({ notificationType: "Complaint", mail: { messageId: "x" }, complaint: { complainedRecipients: [{ emailAddress: "sns@example.com" }] } }) });
  assert.deepEqual((await hookPost(sns)).statuses, ["complained"]);
  assert.equal((await hookPost("{not json")).status, 400);
  // admin endpoints
  const Adm = await mk("mail_admin"); assert.equal((await Adm.req("GET", "/api/email/suppressions")).status, 403);
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [Adm.id]);
  assert.ok((await Adm.req("GET", "/api/email/suppressions")).suppressions.some(s => s.email === "basma@example.com"));
  assert.equal((await Adm.req("DELETE", "/api/email/suppressions/basma@example.com")).ok, true);
  const st = await Adm.req("GET", "/api/email/status");
  assert.equal(st.dkim.enabled, true); assert.equal(st.dkim.record.name, "mp2026._domainkey.mujtama.plus"); assert.match(st.dkim.record.value, /^v=DKIM1; k=rsa; p=/);
  assert.match(st.dmarc.value, /^v=DMARC1;/); assert.equal(st.webhook.configured, true);
});

test("SMTP delivery: 4xx is retried by the queue with exponential backoff, 5xx becomes a hard bounce; DKIM survives the wire", async () => {
  const plan = [], wire = [];
  const srv = net.createServer(sock => {
    let mode = "cmd", data = ""; sock.write("220 fake ESMTP\r\n");
    sock.on("data", d => {
      const s = d.toString();
      if (mode === "data") { data += s; if (data.endsWith("\r\n.\r\n")) { mode = "cmd"; wire.push(data); sock.write("250 queued\r\n"); } return; }
      for (const line of s.split("\r\n").filter(Boolean)) {
        if (line.startsWith("EHLO")) sock.write("250-fake\r\n250 8BITMIME\r\n");
        else if (line.startsWith("MAIL FROM")) { const code = plan.shift() || "250 ok"; sock.write(code + "\r\n"); }
        else if (line.startsWith("RCPT TO")) sock.write("250 ok\r\n");
        else if (line === "DATA") { mode = "data"; data = ""; sock.write("354 go\r\n"); }
        else if (line === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
      }
    });
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const mailer = H.app.ctx.mailer, memSend = mailer.send;
  mailer.send = createMailer(`smtp://127.0.0.1:${srv.address().port}`, { from: process.env.SMTP_FROM }).send;
  try {
    plan.push("451 4.7.1 try again later");
    const q = await H.app.ctx.services.mail.enqueue({ to: "retry@example.com", kind: "security_login", subject: "تنبيه أمان", html: "<p>دخول جديد</p>", text: "دخول جديد", transactional: true });
    assert.equal(q.status, "queued");
    const lg = await until(async () => { const r = await db().get("SELECT status, detail FROM email_log WHERE id=$1", [q.id]); return r.status === "retrying" ? r : null; }, 8000, "retrying");
    assert.match(lg.detail, /451/);
    const job = await until(async () => (await db().all("SELECT * FROM media_jobs WHERE kind='mail.send' AND status='queued'")).find(j => JSON.stringify(j.payload).includes(q.id)), 3000, "requeued");
    const wait = Date.parse(job.run_after) - Date.now(); assert.ok(wait > 2500 && wait <= 4100, "backoff ≈ 4 s after the first failure, got " + wait);
    await db().run("UPDATE media_jobs SET run_after=$1 WHERE id=$2", [new Date(Date.now() - 1000).toISOString(), job.id]);
    await until(async () => (await db().get("SELECT status FROM email_log WHERE id=$1", [q.id])).status === "sent", 8000, "sent after retry");
    assert.equal(wire.length, 1); const raw = wire[0].replace(/\r\n\.\r\n$/, "\r\n").replace(/^\.\./gm, ".");
    assert.ok(DKIM.verify(raw, keys.publicKey).ok, "DKIM verifies on the bytes that crossed SMTP");
    plan.push("550 5.1.1 mailbox does not exist");
    const r = await H.app.ctx.services.mail.sendNow({ to: "gone@example.com", kind: "notify_follow", subject: "x", html: "x", text: "x" });
    assert.deepEqual(r, { status: "bounced", reason: "hard_bounce" });
    assert.equal((await db().get("SELECT reason FROM email_suppressions WHERE email='gone@example.com'")).reason, "hard_bounce");
    assert.equal((await H.app.ctx.services.mail.sendNow({ to: "gone@example.com", kind: "notify_follow", subject: "x", html: "x", text: "x" })).status, "suppressed");
  } finally { mailer.send = memSend; srv.close(); }
});
