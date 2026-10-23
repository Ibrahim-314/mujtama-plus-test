/* Mail adapter (Phase 25 weekly digest, Phase 29 transactional mail). Gated by SMTP_URL:
 *   smtp://user:pass@host:587   → plain connection upgraded with STARTTLS when the server offers it
 *   smtps://user:pass@host:465  → implicit TLS
 *   memory:                     → keeps messages in `outbox` (tests, staging)
 * Unset → mail is disabled and send() reports { skipped: "not_configured" }.
 * Zero dependencies: a small SMTP client on node:net / node:tls (EHLO, STARTTLS, AUTH PLAIN, DATA).
 * Phase 29: extra headers (List-Unsubscribe / List-Unsubscribe-Post, RFC 8058), a stable Message-ID on the
 * sending domain (returned for delivery/bounce tracking) and DKIM signing when DKIM_* is configured (lib/dkim.js). */
const net = require("node:net"), tls = require("node:tls"), os = require("node:os"), crypto = require("node:crypto");
const DKIM = require("./dkim"), { secret } = require("./secrets");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const encHeader = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const domainOf = (addr) => (String(addr).match(/@([^>\s]+)/) || [])[1] || os.hostname();
const newMessageId = (from) => `<${Date.now().toString(36)}.${crypto.randomBytes(8).toString("hex")}@${process.env.DKIM_DOMAIN || domainOf(from)}>`;
const safeHeader = (v) => String(v).replace(/[\r\n]+/g, " ");
/* RFC 2047: an Arabic display name must be encoded, the address part stays ASCII */
const fmtAddr = (a) => { const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(a); return m && m[1] ? `${encHeader(m[1].replace(/^"|"$/g, ""))} <${m[2]}>` : a; };
function buildMessage({ from, to, subject, html, text, headers = {}, messageId = newMessageId(from) }) {
  const boundary = "mp_" + crypto.randomBytes(9).toString("hex");
  const wrap = (s) => b64(s).replace(/.{76}/g, "$&\r\n");
  const extra = Object.entries(headers).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k.replace(/[^A-Za-z0-9-]/g, "")}: ${encHeader(safeHeader(v))}`);
  return [`From: ${fmtAddr(from)}`, `To: ${safeHeader(to)}`, `Subject: ${encHeader(safeHeader(subject))}`, "MIME-Version: 1.0", `Date: ${new Date().toUTCString()}`, `Message-ID: ${messageId}`, ...extra,
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(text || ""),
    `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(html || ""), `--${boundary}--`, ""].join("\r\n");
}
function smtpSend(u, msg, { from, to }) {
  return new Promise((resolve, reject) => {
    const port = +(u.port || (u.protocol === "smtps:" ? 465 : 587));
    let sock = u.protocol === "smtps:" ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port });
    let buf = "", step = "greet", upgraded = u.protocol === "smtps:";
    const user = decodeURIComponent(u.username || ""), pass = decodeURIComponent(u.password || "");
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("smtp timeout")); }, 20000);
    const send = (l) => sock.write(l + "\r\n");
    const done = (e, v) => { clearTimeout(timer); try { sock.end(); } catch { /* closed */ } e ? reject(e) : resolve(v); };
    const onData = (d) => {
      buf += d.toString("utf8");
      const lines = buf.split("\r\n"); if (!/^\d{3} /m.test(buf) || !buf.endsWith("\r\n")) return;
      const last = lines.filter(Boolean).pop(), code = +last.slice(0, 3), all = buf; buf = "";
      if (code >= 400) return done(new Error("smtp " + last));
      if (step === "greet") { step = "ehlo"; send("EHLO " + os.hostname()); }
      else if (step === "ehlo") {
        if (!upgraded && /STARTTLS/i.test(all)) { step = "starttls"; send("STARTTLS"); }
        else if (user) { step = "auth"; send("AUTH PLAIN " + Buffer.from(`\0${user}\0${pass}`).toString("base64")); }
        else { step = "from"; send(`MAIL FROM:<${from}>`); }
      } else if (step === "starttls") {
        sock.removeListener("data", onData);
        sock = tls.connect({ socket: sock, servername: u.hostname }, () => { upgraded = true; step = "ehlo"; send("EHLO " + os.hostname()); });
        sock.on("data", onData); sock.on("error", (e) => done(e));
      } else if (step === "auth") { step = "from"; send(`MAIL FROM:<${from}>`); }
      else if (step === "from") { step = "rcpt"; send(`RCPT TO:<${to}>`); }
      else if (step === "rcpt") { step = "data"; send("DATA"); }
      else if (step === "data") { step = "body"; sock.write(msg.replace(/^\./gm, "..") + "\r\n.\r\n"); }
      else if (step === "body") { step = "quit"; send("QUIT"); done(null, { ok: true, response: last }); }
    };
    sock.on("data", onData); sock.on("error", (e) => done(e));
  });
}
function createMailer(url = process.env.SMTP_URL, { from = process.env.SMTP_FROM || "مجتمع بلس <no-reply@mujtama.plus>", dkim = DKIM.fromEnv(secret) } = {}) {
  const outbox = [];
  const fromAddr = from.match(/<([^>]+)>/)?.[1] || from;
  /* m: { to, subject, html, text, headers?, messageId? } → raw RFC 5322 message, DKIM-signed when configured */
  const compose = (m) => { const messageId = m.messageId || newMessageId(fromAddr); let raw = buildMessage({ ...m, from, messageId }); if (dkim) raw = DKIM.sign(raw, dkim); return { raw, messageId }; };
  const info = { from, fromAddr, dkim: dkim ? { selector: dkim.selector, domain: dkim.domain } : null };
  if (!url) return { enabled: false, outbox, ...info, compose, async send() { return { skipped: "not_configured" }; } };
  if (url === "memory:") return { enabled: true, transport: "memory", outbox, ...info, compose, async send(m) { const { raw, messageId } = compose(m); outbox.push({ ...m, from, raw, messageId }); return { ok: true, messageId }; } };
  const u = new URL(url);
  return { enabled: true, transport: u.protocol.replace(":", ""), outbox, ...info, compose, async send(m) { const { raw, messageId } = compose(m); const r = await smtpSend(u, raw, { from: process.env.SMTP_ENVELOPE_FROM || fromAddr, to: m.to }); return { ...r, messageId }; } };
}
module.exports = { createMailer, buildMessage };
