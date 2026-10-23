/* DKIM signing (Phase 29): RFC 6376, a=rsa-sha256, c=relaxed/relaxed, node:crypto only.
 * Configure with DKIM_PRIVATE_KEY (PEM; "\n" escapes allowed, or DKIM_PRIVATE_KEY_FILE), DKIM_SELECTOR, DKIM_DOMAIN.
 * The public half is published at <selector>._domainkey.<domain> (see dnsRecord / docs/COMMUNICATION.md). */
const crypto = require("node:crypto");
const SIGNED = ["from", "to", "subject", "date", "message-id", "mime-version", "content-type", "reply-to", "list-unsubscribe", "list-unsubscribe-post", "list-id", "feedback-id"];

/** RFC 6376 §3.4.4 relaxed body: strip trailing WSP per line, collapse WSP runs, drop trailing empty lines */
function canonBodyRelaxed(body) {
  let b = body.replace(/\r?\n/g, "\r\n").split("\r\n").map(l => l.replace(/[ \t]+/g, " ").replace(/ $/, "")).join("\r\n");
  b = b.replace(/(\r\n)*$/, "");
  return b.length ? b + "\r\n" : "";
}
/** RFC 6376 §3.4.2 relaxed header: lowercase name, unfold, collapse WSP, trim around the colon and at the end */
function canonHeaderRelaxed(name, value) { return name.toLowerCase().trim() + ":" + value.replace(/\r\n([ \t])/g, "$1").replace(/[ \t]+/g, " ").trim(); }
/** split a raw RFC 5322 message into [{ name, value }] (folded lines joined) and the body */
function parse(raw) {
  const i = raw.indexOf("\r\n\r\n"), head = i < 0 ? raw : raw.slice(0, i), body = i < 0 ? "" : raw.slice(i + 4);
  const headers = [];
  for (const line of head.split("\r\n")) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1].value += "\r\n" + line;
    else { const c = line.indexOf(":"); if (c > 0) headers.push({ name: line.slice(0, c), value: line.slice(c + 1) }); }
  }
  return { headers, body };
}
const normKey = (k) => String(k || "").replace(/\\n/g, "\n").trim();

/** returns the raw message with a DKIM-Signature header prepended */
function sign(raw, { privateKey, selector, domain, now = Date.now(), headers: want = SIGNED }) {
  const { headers, body } = parse(raw);
  const bh = crypto.createHash("sha256").update(canonBodyRelaxed(body)).digest("base64");
  // sign the last instance of each wanted header (bottom-up per RFC 6376 §5.4.2)
  const picked = [];
  for (const n of want) { const h = [...headers].reverse().find(x => x.name.toLowerCase() === n); if (h) picked.push(h); }
  const tags = `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${domain}; s=${selector}; t=${Math.floor(now / 1000)}; h=${picked.map(h => h.name.toLowerCase()).join(":")}; bh=${bh}; b=`;
  const data = picked.map(h => canonHeaderRelaxed(h.name, h.value) + "\r\n").join("") + canonHeaderRelaxed("DKIM-Signature", " " + tags);
  const b = crypto.sign("sha256", Buffer.from(data), normKey(privateKey)).toString("base64");
  // fold only where relaxed canonicalization restores the signed text: after "; " (FWS collapses back to one
  // space) and inside b= (the whole b= value is removed before verification)
  const folded = tags.replace(/; /g, ";\r\n\t") + b.replace(/(.{1,64})(?=.)/g, "$1\r\n\t");
  return `DKIM-Signature: ${folded}\r\n${raw}`;
}
/** verifier used by tests and the admin self-check: recomputes bh and checks b= with the public key */
function verify(raw, publicKey) {
  const { headers, body } = parse(raw);
  const sigH = headers.find(h => h.name.toLowerCase() === "dkim-signature"); if (!sigH) return { ok: false, reason: "no signature" };
  const tags = Object.fromEntries(sigH.value.replace(/\r\n[ \t]/g, "").split(";").map(t => t.trim()).filter(Boolean).map(t => { const i = t.indexOf("="); return [t.slice(0, i).trim(), t.slice(i + 1).replace(/\s+/g, "")]; }));
  if (tags.a !== "rsa-sha256" || tags.c !== "relaxed/relaxed") return { ok: false, reason: "unsupported" };
  const bh = crypto.createHash("sha256").update(canonBodyRelaxed(body)).digest("base64");
  if (bh !== tags.bh) return { ok: false, reason: "body hash mismatch" };
  const rest = headers.filter(h => h !== sigH), used = new Map(), lines = [];
  for (const n of tags.h.split(":")) {
    const all = rest.filter(h => h.name.toLowerCase() === n), k = used.get(n) || 0, h = all[all.length - 1 - k]; used.set(n, k + 1);
    if (h) lines.push(canonHeaderRelaxed(h.name, h.value) + "\r\n");
  }
  const unsigned = sigH.value.replace(/(\bb=)[^;]*$/, "$1");
  const data = lines.join("") + canonHeaderRelaxed("DKIM-Signature", unsigned);
  const ok = crypto.verify("sha256", Buffer.from(data), publicKey, Buffer.from(tags.b, "base64"));
  return { ok, reason: ok ? null : "signature mismatch", domain: tags.d, selector: tags.s };
}
/** the TXT record to publish for a private key */
function dnsRecord({ privateKey, selector, domain }) {
  const pub = crypto.createPublicKey(normKey(privateKey)).export({ type: "spki", format: "der" }).toString("base64");
  return { name: `${selector}._domainkey.${domain}`, type: "TXT", value: `v=DKIM1; k=rsa; p=${pub}` };
}
function fromEnv(secret) {
  const privateKey = secret("DKIM_PRIVATE_KEY"), selector = process.env.DKIM_SELECTOR, domain = process.env.DKIM_DOMAIN;
  return privateKey && selector && domain ? { privateKey: normKey(privateKey), selector, domain } : null;
}
module.exports = { sign, verify, dnsRecord, fromEnv, canonBodyRelaxed, canonHeaderRelaxed, parse };
