/* Track 6 — unit tests: Web Push RFC 8291 test vector, VAPID ES256 JWT verification, DKIM signature
 * (relaxed/relaxed, rsa-sha256) verified independently with node:crypto, mailer headers, quiet hours,
 * grouping and Arabic wording of notifications. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const WP = require("../../server/lib/webpush");
const DKIM = require("../../server/lib/dkim");
const NL = require("../../server/lib/notify-lib");
const { createMailer } = require("../../server/lib/mailer");
const j = (s) => s.replace(/\s+/g, "");

/* RFC 8291 Appendix A */
const V = {
  plain: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPublic: j("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: j("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header: j("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8"),
  ct: j("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ")
};

test("Web Push: RFC 8291 Appendix A test vector reproduces byte-for-byte", () => {
  const body = WP.encrypt(WP.unb64u(V.plain), { p256dh: V.uaPublic, auth: V.auth }, { salt: WP.unb64u(V.salt), asPrivateKey: V.asPrivate });
  const expected = Buffer.concat([WP.unb64u(V.header), WP.unb64u(V.ct)]);
  assert.equal(WP.unb64u(V.header).length, 86, "86-octet header");
  assert.equal(WP.b64u(body), WP.b64u(expected));
  const back = WP.decrypt(body, { uaPrivateKey: V.uaPrivate, auth: V.auth });
  assert.equal(back.toString(), "When I grow up, I want to be a watermelon");
});

test("Web Push: random-salt roundtrip, wrong auth fails, input validation", () => {
  const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
  const auth = WP.b64u(crypto.randomBytes(16));
  const keys = { p256dh: WP.b64u(ua.getPublicKey()), auth };
  const msg = JSON.stringify({ title: "مجتمع بلس", body: "أرسل إليك أحمد رسالة 💬" });
  const a = WP.encrypt(msg, keys), b = WP.encrypt(msg, keys);
  assert.notEqual(WP.b64u(a), WP.b64u(b), "fresh salt + ephemeral key each time");
  assert.equal(a.readUInt32BE(16), 4096, "record size");
  assert.equal(WP.decrypt(a, { uaPrivateKey: WP.b64u(ua.getPrivateKey()), auth }).toString(), msg);
  assert.throws(() => WP.decrypt(a, { uaPrivateKey: WP.b64u(ua.getPrivateKey()), auth: WP.b64u(crypto.randomBytes(16)) }));
  assert.throws(() => WP.encrypt("x", { p256dh: WP.b64u(crypto.randomBytes(10)), auth }), /p256dh/);
  assert.throws(() => WP.encrypt("x", { ...keys, auth: WP.b64u(crypto.randomBytes(8)) }), /auth/);
  assert.throws(() => WP.encrypt("x".repeat(5000), keys), /too large/);
});

test("VAPID: ES256 JWT verifies with the public key (raw r||s), claims and header format", () => {
  const k = WP.generateVapidKeys();
  assert.equal(WP.unb64u(k.publicKey).length, 65); assert.equal(WP.unb64u(k.privateKey).length, 32);
  const now = Date.UTC(2026, 9, 16, 12, 0, 0);
  const jwt = WP.vapidJwt({ audience: "https://fcm.googleapis.com", subject: "mailto:ops@mujtama.plus", ...k, now, expSeconds: 99 * 3600 });
  const [h, b, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(WP.unb64u(h)), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(WP.unb64u(b));
  assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.equal(claims.sub, "mailto:ops@mujtama.plus");
  assert.equal(claims.exp, now / 1000 + 24 * 3600, "exp capped at 24 h (RFC 8292 §2)");
  const pub = WP.unb64u(k.publicKey);
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: WP.b64u(pub.subarray(1, 33)), y: WP.b64u(pub.subarray(33)) }, format: "jwk" });
  assert.equal(WP.unb64u(s).length, 64, "JOSE signature is 64 raw bytes");
  assert.ok(crypto.verify("sha256", Buffer.from(h + "." + b), { key, dsaEncoding: "ieee-p1363" }, WP.unb64u(s)));
  assert.ok(!crypto.verify("sha256", Buffer.from(h + "." + b + "x"), { key, dsaEncoding: "ieee-p1363" }, WP.unb64u(s)));
  const hdr = WP.vapidHeaders("https://updates.push.services.mozilla.com/wpush/v2/abc", { subject: "mailto:a@b.c", ...k });
  assert.match(hdr.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${k.publicKey}$`));
  assert.equal(JSON.parse(WP.unb64u(hdr.Authorization.split(" t=")[1].split(".")[1])).aud, "https://updates.push.services.mozilla.com");
});

test("push endpoint SSRF guard", () => {
  assert.ok(WP.endpointAllowed("https://fcm.googleapis.com/fcm/send/x", { production: true, hosts: [] }));
  assert.ok(WP.endpointAllowed("https://web.push.apple.com/abc", { production: true, hosts: [] }));
  assert.ok(!WP.endpointAllowed("http://fcm.googleapis.com/x", { production: true, hosts: [] }));
  assert.ok(!WP.endpointAllowed("https://169.254.169.254/latest", { production: true, hosts: [] }));
  assert.ok(!WP.endpointAllowed("https://evilfcm.googleapis.com.attacker.io/x", { production: true, hosts: [] }));
  assert.ok(WP.endpointAllowed("http://127.0.0.1:9999/push", { production: false }));
  assert.ok(!WP.endpointAllowed("not a url", { production: false }));
});

/* ---------- DKIM ---------- */
const { privateKey: dkPriv, publicKey: dkPub } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

/** independent RFC 6376 relaxed/relaxed verifier (does not reuse dkim.js helpers) */
function independentVerify(raw, pubPem) {
  const sep = raw.indexOf("\r\n\r\n"), head = raw.slice(0, sep), body = raw.slice(sep + 4);
  const hs = []; for (const l of head.split("\r\n")) { if (/^[ \t]/.test(l)) hs[hs.length - 1].raw += "\r\n" + l; else hs.push({ raw: l }); }
  for (const h of hs) { const i = h.raw.indexOf(":"); h.name = h.raw.slice(0, i); h.value = h.raw.slice(i + 1); }
  const canonH = (n, v) => n.toLowerCase().trim() + ":" + v.replace(/\r\n(?=[ \t])/g, "").replace(/[ \t]+/g, " ").trim();
  let cb = body.split("\r\n").map(l => l.replace(/[ \t]+/g, " ").replace(/ +$/, "")).join("\r\n").replace(/(\r\n)+$/, "");
  cb = cb ? cb + "\r\n" : "";
  const sig = hs.find(h => h.name.toLowerCase() === "dkim-signature");
  const tags = {}; for (const t of sig.value.replace(/\s+/g, "").split(";")) if (t) { const i = t.indexOf("="); tags[t.slice(0, i)] = t.slice(i + 1); }
  if (crypto.createHash("sha256").update(cb).digest("base64") !== tags.bh) return { ok: false, why: "bh" };
  const others = hs.filter(h => h !== sig).reverse(), seen = {};
  let data = "";
  for (const n of tags.h.split(":")) { const c = others.filter(h => h.name.toLowerCase() === n); const h = c[seen[n] = (seen[n] ?? -1) + 1]; if (h) data += canonH(h.name, h.value) + "\r\n"; }
  data += canonH(sig.name, sig.value.replace(/b=[^;]*$/, "b="));
  return { ok: crypto.verify("sha256", Buffer.from(data), pubPem, Buffer.from(tags.b, "base64")), tags };
}

test("DKIM: signed mail verifies with node:crypto (independent verifier + dkim.verify); tampering detected", () => {
  const mailer = createMailer("memory:", { from: "مجتمع بلس <no-reply@mujtama.plus>", dkim: { privateKey: dkPriv, selector: "mp2026", domain: "mujtama.plus" } });
  const { raw } = mailer.compose({ to: "user@example.com", subject: "رمز التحقق الخاص بك", text: "الرمز: 123456  \n\n\n", html: "<p dir=rtl>الرمز: <b>123456</b></p>", headers: { "List-Unsubscribe": "<https://mujtama.plus/u/abc>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
  assert.match(raw, /^DKIM-Signature: v=1;/);
  const iv = independentVerify(raw, dkPub);
  assert.ok(iv.ok, "independent verifier: " + iv.why);
  assert.equal(iv.tags.d, "mujtama.plus"); assert.equal(iv.tags.s, "mp2026"); assert.equal(iv.tags.a, "rsa-sha256"); assert.equal(iv.tags.c, "relaxed/relaxed");
  for (const h of ["from", "to", "subject", "date", "message-id", "list-unsubscribe", "list-unsubscribe-post"]) assert.ok(iv.tags.h.split(":").includes(h), "signs " + h);
  assert.ok(DKIM.verify(raw, dkPub).ok);
  // relaxed canonicalisation survives whitespace-only changes in transit
  const ws = raw.replace(/^Subject:/m, "subject:   ").replace(/\r\n\r\n--/, "\r\n\r\n--");
  assert.ok(independentVerify(ws, dkPub).ok, "header case/whitespace tolerated");
  assert.ok(!independentVerify(raw.replace(/^To: user@example.com/m, "To: attacker@example.com"), dkPub).ok);
  assert.ok(!DKIM.verify(raw.replace(/^To: user@example.com/m, "To: attacker@example.com"), dkPub).ok);
  const sep = raw.indexOf("\r\n\r\n");
  assert.equal(DKIM.verify(raw.slice(0, sep + 4) + "X" + raw.slice(sep + 4), dkPub).reason, "body hash mismatch");
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;
  assert.ok(!DKIM.verify(raw, other).ok);
  const rec = DKIM.dnsRecord({ privateKey: dkPriv, selector: "mp2026", domain: "mujtama.plus" });
  assert.equal(rec.name, "mp2026._domainkey.mujtama.plus"); assert.match(rec.value, /^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]+$/);
  // the DNS record's key verifies too
  const p = rec.value.split("p=")[1];
  assert.ok(DKIM.verify(raw, crypto.createPublicKey({ key: Buffer.from(p, "base64"), format: "der", type: "spki" })).ok);
});

test("DKIM: canonicalisation primitives (RFC 6376 §3.4)", () => {
  assert.equal(DKIM.canonHeaderRelaxed("SubJect", " A  \t b\r\n  c  "), "subject:A b c");
  assert.equal(DKIM.canonBodyRelaxed(" a  b \r\n\r\n\r\n"), " a b\r\n");
  assert.equal(DKIM.canonBodyRelaxed(""), "");
  assert.equal(DKIM.canonBodyRelaxed("\r\n\r\n"), "");
  assert.equal(DKIM.canonBodyRelaxed("x"), "x\r\n");
});

test("mailer: unsigned without DKIM config, RFC 2047 Arabic display name and subject, header injection stripped", () => {
  const m = createMailer("memory:", { from: "مجتمع بلس <no-reply@mujtama.plus>", dkim: null });
  const { raw, messageId } = m.compose({ to: "a@b.c", subject: "مرحباً\r\nBcc: evil@x.y", text: "x", headers: { "X-Test\r\nBcc": "v\r\nBcc: z@z" } });
  assert.ok(!/^DKIM-Signature/m.test(raw));
  assert.ok(!/^Bcc:/mi.test(raw), "no injected header line");
  assert.match(raw, /^From: =\?UTF-8\?B\?[^?]+\?= <no-reply@mujtama\.plus>/m);
  assert.match(messageId, /^<[^@>]+@[^>]+>$/);
  assert.ok(raw.includes(`Message-ID: ${messageId}`));
});

/* ---------- quiet hours / grouping ---------- */
test("quiet hours: overnight window in the user's timezone, all-day, urgent bypass, end instant", () => {
  const q = { enabled: true, start: "22:00", end: "07:00", tz: "Asia/Riyadh" }; // UTC+3, no DST
  const at = (hhmmUtc) => new Date(`2026-10-16T${hhmmUtc}:00Z`);
  assert.equal(NL.inQuietHours(at("19:00"), q), true, "22:00 Riyadh");
  assert.equal(NL.inQuietHours(at("18:59"), q), false, "21:59 Riyadh");
  assert.equal(NL.inQuietHours(at("03:59"), q), true, "06:59 Riyadh");
  assert.equal(NL.inQuietHours(at("04:00"), q), false, "07:00 Riyadh — end is exclusive");
  assert.equal(NL.inQuietHours(at("10:00"), { ...q, enabled: false }), false);
  assert.equal(NL.inQuietHours(at("10:00"), { ...q, start: "09:00", end: "09:00" }), true, "start==end → all day");
  assert.equal(NL.inQuietHours(at("10:00"), { ...q, start: "12:00", end: "14:00" }), true, "daytime window 13:00 Riyadh");
  assert.equal(NL.inQuietHours(at("10:00"), { ...q, start: "25:00" }), false, "invalid time ignored");
  assert.equal(NL.inQuietHours(at("19:30"), { ...q, tz: "Not/AZone" }), false, "invalid tz falls back to UTC (19:30 UTC not quiet)");
  assert.equal(NL.quietEndsAt(at("20:15"), q).toISOString(), "2026-10-17T04:00:00.000Z");
  assert.equal(NL.quietEndsAt(at("12:00"), q), null);
  assert.deepEqual(NL.pushDecision(at("12:00"), q, 30), { action: "send" });
  assert.equal(NL.pushDecision(at("20:00"), q, 30).action, "defer");
  assert.equal(NL.pushDecision(at("20:00"), q, 100).urgent, true);
  assert.equal(NL.pushDecision(at("20:00"), { ...q, allowUrgent: false }, 100).action, "defer");
  // DST zone: 22:00 New York in summer is 02:00 UTC, in winter 03:00 UTC
  const ny = { enabled: true, start: "22:00", end: "06:00", tz: "America/New_York" };
  assert.equal(NL.inQuietHours(new Date("2026-07-01T02:30:00Z"), ny), true);
  assert.equal(NL.inQuietHours(new Date("2026-12-01T02:30:00Z"), ny), false);
});

test("grouping, Arabic actor phrases, per-kind channels with locks, ranking", () => {
  const t0 = Date.parse("2026-10-16T10:00:00Z"), at = (m) => new Date(t0 - m * 60e3).toISOString();
  const list = [
    { id: 1, kind: "reaction", post: "p1", actor: "أحمد", at: at(0) },
    { id: 2, kind: "reaction", post: "p1", actor: "سارة", at: at(5) },
    { id: 3, kind: "reaction", post: "p1", actor: "أحمد", at: at(6) },
    { id: 4, kind: "reaction", post: "p2", actor: "علي", at: at(7) },
    { id: 5, kind: "mention", post: "p1", actor: "منى", at: at(8) },
    { id: 6, kind: "mention", post: "p1", actor: "هند", at: at(9) },
    { id: 7, kind: "reaction", post: "p1", actor: "زيد", at: at(60 * 50) }
  ];
  const g = NL.group(list);
  const p1 = g.find(x => x.key === "reaction:p1");
  assert.deepEqual(p1.ids, [1, 2, 3]); assert.deepEqual(p1.actors, ["أحمد", "سارة"]); assert.equal(p1.count, 2);
  assert.equal(g.filter(x => x.kind === "mention").length, 2, "mentions never group");
  assert.equal(g.filter(x => x.key === "reaction:p1").length, 2, "outside 48 h window starts a new group");
  assert.equal(NL.actorsText(["أحمد"]), "أحمد");
  assert.equal(NL.actorsText(["أحمد", "سارة"]), "أحمد وسارة");
  assert.equal(NL.actorsText(["أحمد"], 3), "أحمد وشخصان آخران");
  assert.equal(NL.actorsText(["أحمد"], 6), "أحمد و5 آخرون");
  assert.equal(NL.actorsText(["أحمد"], 13), "أحمد و12 شخصاً آخر");
  assert.equal(NL.sentence("reaction", ["أحمد"], 6), "أحمد و5 آخرون أعجبهم منشورك");
  assert.equal(NL.sentence("follow", ["أحمد", "سارة"], 2), "أحمد وسارة بدآ بمتابعتك");
  const ch = NL.channelsFor("security_login", { security_login: { inapp: 0, email: 0, push: 0 } });
  assert.deepEqual(ch, { inapp: 1, push: 0, email: 1 }, "locked channels cannot be turned off");
  assert.deepEqual(NL.channelsFor("reaction", { reaction: { push: 0 } }), { inapp: 1, push: 0, email: 0 });
  assert.deepEqual(NL.channelsFor("reaction", {}, { reaction: false }), { inapp: 0, push: 0, email: 0 }, "legacy off switch");
  assert.equal(NL.importanceAtWrite("reaction", { mutual: true, verified: true }), 50);
  const r = NL.rank([{ key: "a", importance: 30, at: at(0), count: 1 }, { key: "b", importance: 95, at: at(60 * 24 * 5), count: 1 }, { key: "c", importance: 75, at: at(0), read: true, count: 1 }], t0);
  assert.equal(r[0].key, "b", "urgent never decays");
  assert.equal(NL.hrefFor({ kind: "message", ref: "c9" }), "/#/chat/c9");
  assert.equal(NL.hrefFor({ kind: "security_login" }), "/#/security");
});

/* v2.62 community auto-guard notifications: counts + duration in the text, deep link to the community, no word list */
test("auto-guard notifications: strike text, lock text, deep link, i18n patterns", () => {
  const fs = require("node:fs"), path = require("node:path");
  const ref = NL.guardRef("c_abc123", { n: 2, max: 3, hours: 1 });
  assert.equal(ref, "c_abc123~2~3~1");
  assert.deepEqual(NL.parseGuardRef(ref), { cid: "c_abc123", n: 2, max: 3, hours: 1 });
  assert.deepEqual(NL.parseGuardRef("c_abc123"), { cid: "c_abc123", n: null, max: null, hours: null });
  assert.equal(NL.parseGuardRef(NL.guardRef("c_x", { n: 9, max: 3, hours: 99999 })).n, 3, "n clamped to max");
  assert.equal(NL.parseGuardRef(NL.guardRef("c_x", { n: 1, max: 3, hours: 99999 })).hours, 720, "hours clamped");
  assert.equal(NL.guardRef("c_x", {}), "c_x", "no counters → plain id");
  const s = (h, n = 2, max = 3) => NL.sentence("autoguard_strike", [], 1, NL.guardRef("c_abc123", { n, max, hours: h }));
  assert.equal(s(1), "تحذير 2 من 3 في المجتمع: لم يُنشر نصك لاحتوائه عبارة ممنوعة · لا يمكنك الكتابة لمدة ساعة");
  assert.equal(s(6), "تحذير 2 من 3 في المجتمع: لم يُنشر نصك لاحتوائه عبارة ممنوعة · لا يمكنك الكتابة لمدة 6 ساعة");
  assert.equal(s(24), "تحذير 2 من 3 في المجتمع: لم يُنشر نصك لاحتوائه عبارة ممنوعة · لا يمكنك الكتابة لمدة يوم");
  assert.equal(s(72), "تحذير 2 من 3 في المجتمع: لم يُنشر نصك لاحتوائه عبارة ممنوعة · لا يمكنك الكتابة لمدة 3 يوم");
  assert.equal(s(0, 1, 5), "تحذير 1 من 5 في المجتمع: لم يُنشر نصك لاحتوائه عبارة ممنوعة", "warning only, no mute");
  assert.equal(NL.sentence("autoguard_strike", [], 1, "c_abc123"), "وصلك تحذير من الحارس التلقائي في المجتمع", "plain ref falls back");
  assert.equal(NL.sentence("autoguard_lock", [], 1, "c_abc123"), "أُوقفت عن الكتابة في المجتمع حتى يرفع مشرف الإيقاف");
  assert.equal(NL.sentence("mod_warning", ["أحمد"], 1, "c_abc123"), "أحمد وجّه إليك تنبيهاً من مشرفي المجتمع", "other kinds unchanged");
  assert.equal(NL.hrefFor({ kind: "autoguard_strike", ref }), "/#/c/c_abc123");
  assert.equal(NL.hrefFor({ kind: "autoguard_lock", ref: "c_abc123" }), "/#/c/c_abc123");
  assert.equal(NL.hrefFor({ kind: "autoguard_lock", ref: null }), "/#/communities");
  for (const k of ["autoguard_strike", "autoguard_lock"]) {
    const K = NL.kindOf(k);
    assert.equal(K.tab, "communities"); assert.ok(K.label);
    const ch = NL.channelsFor(k, { [k]: { push: 0, email: 0 } });
    assert.equal(ch.push, 0, "respects the user's channel prefs"); assert.equal(ch.email, 0); assert.equal(ch.inapp, 1);
  }
  // every Arabic string the guard can produce has en through the {n} number pattern
  const keys = [s(1), s(6), s(24), s(72), s(0), NL.kindOf("autoguard_strike").v[0], NL.kindOf("autoguard_lock").v[0], NL.kindOf("autoguard_strike").label, NL.kindOf("autoguard_lock").label]
    .map(t => t.replace(/[0-9]+/g, "{n}"));
  const ROOT = path.join(__dirname, "../..");
  for (const L of ["en"]) {
    const src = fs.readFileSync(path.join(ROOT, `i18n-${L}.js`), "utf8");
    for (const k of keys) assert.ok(src.includes(JSON.stringify(k)), `${L}: ${k}`);
  }
});
