/* global MPComms, Remote */
/* Track 6 — chat in a real browser (production build, lazy comms chunks): two browser contexts chat in an
 * end-to-end encrypted DM (lock visible, server stores ciphertext only, live delivery over WebSocket),
 * regressions for the comms-core app bridge (DB/Remote are lexical globals) and the stale conversation
 * cache (send(id) after a peer enabled E2EE), and an axe audit of the new chat screens. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S, A, B, C; const errors = [];
const ids = {};
/* poll with evaluate: waitForFunction evals a string in-page, which the app's strict CSP forbids */
const until = async (P, fn, arg, timeout = 10000) => { const end = Date.now() + timeout; for (;;) { const v = await P.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 140)); await P.waitForTimeout(100); } };
const call = (P, method, path, body) => P.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [method, path, body]);
async function user(handle, name) {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const P = await ctx.newPage();
  P.on("pageerror", e => errors.push(handle + ": " + e.message));
  await onboard(P, S.base, handle, name);
  ids[handle] = (await call(P, "GET", "/api/me")).user.id;
  await until(P, (id) => typeof DB !== "undefined" && DB.me === id && typeof Remote !== "undefined" && Remote.on, ids[handle]);
  return P;
}
const go = async (P, hash) => { await P.evaluate((h) => { location.hash = h; }, hash); await P.waitForTimeout(150); };
const devices = (P) => call(P, "GET", "/api/e2ee/devices").then(r => (r.devices || []).filter(d => !d.revoked).length);

test.before(async () => {
  S = await startStack();
  A = await user("amal_cm", "أمل"); B = await user("badr_cm", "بدر"); C = await user("chadi_cm", "شادي");
  for (const [p, other] of [[A, "badr_cm"], [B, "amal_cm"], [A, "chadi_cm"], [C, "amal_cm"]]) await call(p, "PUT", "/api/follows/" + ids[other]);
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("comms-core works without the UI's window.DB/Remote shim: lexical app globals are bridged, transport connects", async () => {
  await go(A, "#/messages"); await until(A, () => !!window.MPComms && !!document.querySelector(".cm-wrap, .cm-row, .cm-empty, main"));
  assert.ok(await A.evaluate(() => Object.keys(window.__CHUNKS || {}).includes("comms-core")), "comms core is its own chunk");
  // remove the UI layer's compatibility getters: the core must still see the signed-in user and the API
  const r = await A.evaluate(async () => {
    delete window.DB; delete window.Remote;
    const out = { propGone: !("DB" in window) && !("Remote" in window), me: MPComms.lib._bridge.meId(), expect: DB.me, online: MPComms.lib._bridge.online() };
    MPComms.disconnect(); MPComms.connect();
    const dev = await MPComms.e2ee.ready(); out.device = dev.id;
    return out;
  });
  assert.equal(r.propGone, true); assert.equal(r.me, r.expect, "bare `DB` binding read through the bridge"); assert.equal(r.online, true);
  assert.match(r.device, /^dk_/);
  await until(A, () => MPComms.transport() === "ws");
  assert.equal(await devices(A), 1, "this browser registered exactly one device key");
});

test("two browsers chat end-to-end encrypted: lock visible, ciphertext on the server, live WebSocket delivery both ways", async () => {
  await go(B, "#/messages"); await until(B, () => !!window.MPComms);
  await until(B, async () => (await MPComms.e2ee.ready()) && true);
  assert.equal(await devices(B), 1);
  const conv = await A.evaluate(async (peer) => { const c = await MPComms.openDM(peer); return { id: c.id, e2ee: c.e2ee }; }, ids.badr_cm);
  assert.equal(conv.e2ee, true, "openDM switches E2EE on when both sides have device keys"); ids.dm = conv.id;
  await go(A, "#/chat/" + conv.id); await A.waitForSelector("#cm-thread"); await A.waitForSelector("#cm-ta");
  await A.waitForSelector("#cm-ch .cm-lockc", { state: "visible" });
  assert.match(await A.textContent("#cm-ch"), /مشفرة طرفاً لطرف/);
  assert.match(await A.textContent(".cm-e2ee"), /مشفرة طرفاً لطرف/);
  assert.equal(await A.getAttribute("#cm-ta", "placeholder"), "رسالة مشفرة…");
  await go(B, "#/chat/" + conv.id); await B.waitForSelector("#cm-ta");
  await until(B, () => MPComms.transport() === "ws");
  const SECRET = "موعدنا عند البوابة الشمالية 🌙";
  await A.fill("#cm-ta", SECRET); await A.click("#cm-send");
  await until(B, (t) => [...document.querySelectorAll("#cm-thread .cm-b")].some(b => b.textContent.includes(t)), SECRET);
  await until(A, (t) => [...document.querySelectorAll("#cm-thread .cm-b")].some(b => b.textContent.includes(t)), SECRET);
  // the server only ever saw ciphertext
  const rows = await S.app.ctx.db.all("SELECT text, payload FROM messages WHERE conv=$1 AND kind<>'system'", [conv.id]);
  assert.ok(rows.length >= 1); assert.ok(rows.every(r => r.text === "" && r.payload && r.payload.ct));
  assert.ok(!JSON.stringify(rows).includes("البوابة"), "no plaintext stored");
  // reply from B arrives live in A (no reload)
  const REPLY = "تمام، أراك هناك";
  await B.fill("#cm-ta", REPLY); await B.click("#cm-send");
  await until(A, (t) => [...document.querySelectorAll("#cm-thread .cm-b")].some(b => b.textContent.includes(t)), REPLY);
  // the conversation list shows the lock too
  await go(B, "#/messages"); await B.waitForSelector(`.cm-row[href="#/chat/${conv.id}"] .cm-lockc`);
  assert.match(await B.getAttribute(`.cm-row[href="#/chat/${conv.id}"]`, "aria-label"), /مشفرة/);
});

test("encrypted image + voice attachments: opaque on the server, decrypted in the other browser, image rendered in the thread", async () => {
  await go(B, "#/chat/" + ids.dm); await B.waitForSelector("#cm-thread");
  const sent = await A.evaluate(async (cid) => {
    const c = document.createElement("canvas"); c.width = 64; c.height = 48; const g = c.getContext("2d"); g.fillStyle = "#0f766e"; g.fillRect(0, 0, 64, 48); g.fillStyle = "#fff"; g.fillRect(8, 8, 20, 20);
    const png = await new Promise(r => c.toBlob(r, "image/png"));
    const ogg = new Blob([new Uint8Array([0x4f, 0x67, 0x67, 0x53, ...Array.from({ length: 3000 }, (_, i) => i % 251)])], { type: "audio/ogg" });
    const img = await MPComms.send(cid, { file: new File([png], "مربع.png", { type: "image/png" }), meta: { w: 64, h: 48 }, text: "صورة الموقع" });
    const voice = await MPComms.send(cid, { file: ogg, meta: { duration: 2.5, wave: [10, 40, 90, 20] } });
    const hash = async (b) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await b.arrayBuffer()))).map(x => x.toString(16).padStart(2, "0")).join("");
    return { img: img.id, voice: voice.id, kinds: [img.kind, voice.kind], pngHash: await hash(png), oggHash: await hash(ogg) };
  }, ids.dm);
  assert.deepEqual(sent.kinds, ["image", "voice"]);
  const blobs = await S.app.ctx.db.all("SELECT b.mime, b.enc, m.kind, m.meta FROM chat_blobs b JOIN messages m ON m.id=b.msg WHERE m.id IN ($1,$2)", [sent.img, sent.voice]);
  assert.equal(blobs.length, 2); assert.ok(blobs.every(b => b.enc === 1 && b.mime === "application/octet-stream"), "server stores opaque ciphertext");
  assert.ok(blobs.every(b => Object.keys(b.meta).join() === "blob"), "no plaintext metadata (mime, size, waveform) on the server");
  const got = await B.evaluate(async ([cid, ids]) => {
    const h = await MPComms.messages(cid), out = {};
    const hash = async (b) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await b.arrayBuffer()))).map(x => x.toString(16).padStart(2, "0")).join("");
    for (const [k, id] of Object.entries(ids)) {
      const m = await MPComms.open(h.messages.find(x => x.id === id)); const url = await MPComms.attachmentUrl(m); MPComms.release(url);
      // the page CSP forbids fetch(blob:), so decrypt the member-only ciphertext with the same library call attachmentUrl uses
      const ct = await (await fetch("/api/chat/blobs/" + m.meta.blob)).arrayBuffer();
      const b = await MPComms.lib.decryptFile(ct, m.file.fk, m.file.fiv, m.meta.mime);
      out[k] = { kind: m.kind, text: m.text, mime: b.type, hash: await hash(b), blobUrl: url.startsWith("blob:"), meta: m.meta, ctLen: ct.byteLength, plainLen: b.size };
    }
    return out;
  }, [ids.dm, { img: sent.img, voice: sent.voice }]);
  assert.equal(got.img.hash, sent.pngHash, "image decrypts byte-for-byte"); assert.equal(got.img.mime, "image/png"); assert.equal(got.img.blobUrl, true); assert.equal(got.img.text, "صورة الموقع");
  assert.equal(got.voice.hash, sent.oggHash, "voice note decrypts byte-for-byte"); assert.equal(got.voice.ctLen, got.voice.plainLen + 16, "server holds AES-GCM ciphertext"); assert.equal(got.voice.mime, "audio/ogg"); assert.equal(got.voice.meta.duration, 2.5);
  await B.waitForSelector(`#cm-thread [data-id="${sent.img}"] img.cm-img`, { timeout: 10000 });
  await until(B, (id) => (document.querySelector(`#cm-thread [data-id="${id}"] img.cm-img`)?.src || "").startsWith("blob:"), sent.img);
  await B.waitForSelector(`#cm-thread [data-id="${sent.voice}"]`);
});

test("delete for everyone and disappearing messages update the other browser live", async () => {
  await go(B, "#/chat/" + ids.dm); await B.waitForSelector("#cm-thread");
  const m = await A.evaluate((cid) => MPComms.send(cid, { text: "رسالة سأحذفها" }), ids.dm);
  await until(B, (t) => document.querySelector("#cm-thread").textContent.includes(t), "رسالة سأحذفها");
  await A.evaluate((id) => MPComms.deleteForEveryone(id), m.id);
  await until(B, (id) => !!document.querySelector(`#cm-thread [data-id="${id}"] .cm-b.del`), m.id);
  assert.ok(!(await B.textContent("#cm-thread")).includes("رسالة سأحذفها"), "text gone in the other browser");
  assert.equal((await S.app.ctx.db.get("SELECT payload FROM messages WHERE id=$1", [m.id])).payload, null, "ciphertext wiped on the server");
  // disappearing: 5-minute timer, then the server sweeps it and the bubble disappears for both
  await A.evaluate((cid) => MPComms.setTimer(cid, 300), ids.dm);
  const e = await A.evaluate((cid) => MPComms.send(cid, { text: "ستختفي هذه" }), ids.dm);
  assert.ok(e.expiresAt); const left = Date.parse(e.expiresAt) - Date.now(); assert.ok(left > 280e3 && left <= 300e3);
  await until(B, (id) => !!document.querySelector(`#cm-thread [data-id="${id}"] [data-exp]`), e.id);
  await S.app.ctx.db.run("UPDATE messages SET expires_at=$1 WHERE id=$2", [new Date(Date.now() - 1000).toISOString(), e.id]);
  assert.ok((await S.app.ctx.services.chat.sweep()) >= 1);
  await until(B, (id) => !document.querySelector(`#cm-thread [data-id="${id}"]`), e.id);
  await until(A, (id) => !document.querySelector(`#cm-thread [data-id="${id}"]`) || true, e.id);
  await A.evaluate((cid) => MPComms.setTimer(cid, 0), ids.dm);
});

test("message request from a stranger: recipient gets a notification + toast and the request screen; accepting opens the chat", async () => {
  const D = await user("dana_cm", "دانة");
  await go(B, "#/home"); await B.evaluate(() => window.MPChunks?.load("notify")); await until(B, () => !!document.getElementById("nf-toasts"));
  const cv = (await call(D, "POST", "/api/conversations", { user: ids.badr_cm })).conversation; assert.equal(cv.request, true);
  await call(D, "POST", `/api/chat/conversations/${cv.id}/messages`, { text: "مرحباً، هل يمكن أن نتعاون؟" });
  const toast = await until(B, () => [...document.querySelectorAll("#nf-toasts .nf-toast")].map(t => t.textContent).find(t => /دانة/.test(t)) || null);
  assert.match(toast, /دانة.*يريد مراسلتك/);
  const n = await call(B, "GET", "/api/notifications?view=center&tab=messages"); assert.ok(n.groups.some(g => g.kind === "message_request" && g.ref === cv.id));
  await go(B, "#/message-requests"); await B.waitForSelector(`[data-acc="${cv.id}"]`, { timeout: 10000 });
  await B.click(`[data-acc="${cv.id}"]`);
  await until(B, (id) => location.hash === "#/chat/" + id, cv.id);
  await until(B, () => document.querySelector("#cm-thread")?.textContent.includes("نتعاون"));
});

test("safety number: both browsers compute the same 60 digits; verifying marks the chat as verified", async () => {
  const a = await A.evaluate((p) => MPComms.e2ee.safetyNumber(DB.me, p), ids.badr_cm);
  const b = await B.evaluate((p) => MPComms.e2ee.safetyNumber(DB.me, p), ids.amal_cm);
  assert.match(a, /^\d{60}$/); assert.equal(a, b);
  await A.evaluate((p) => MPComms.e2ee.verify(p), ids.badr_cm);
  assert.equal((await A.evaluate((p) => MPComms.e2ee.verification(p), ids.badr_cm)).state, "verified");
  await go(A, "#/chatinfo/" + ids.dm); await A.waitForSelector(".cm-badge.ok");
});

test("send(id) after the peer enabled E2EE (stale list cache) goes out encrypted", async () => {
  await go(C, "#/messages"); await until(C, async () => !!window.MPComms && !!(await MPComms.e2ee.ready()));
  const open = await call(A, "POST", "/api/conversations", { user: ids.chadi_cm }); const cid = open.conversation.id;
  // A caches the conversation list while the chat is still plaintext
  const before = await A.evaluate(async (id) => (await MPComms.conversations()).conversations.find(c => c.id === id)?.e2ee, cid);
  assert.equal(before, false);
  A.evaluate(() => MPComms.disconnect()); // no realtime "conv" event will invalidate A's cache
  assert.equal((await call(C, "POST", `/api/e2ee/conversations/${cid}/enable`)).e2ee, true);
  const m = await A.evaluate(async (id) => { const r = await MPComms.send(id, { text: "بعد التفعيل مباشرة" }); return { encrypted: !!r.encrypted, text: r.text }; }, cid);
  assert.deepEqual(m, { encrypted: true, text: "بعد التفعيل مباشرة" });
  const row = await S.app.ctx.db.get("SELECT text, payload FROM messages WHERE conv=$1 AND kind='text' ORDER BY created_at DESC LIMIT 1", [cid]);
  assert.equal(row.text, ""); assert.ok(row.payload.ct);
  const got = await C.evaluate(async (id) => { const h = await MPComms.messages(id); return (await MPComms.open(h.messages[h.messages.length - 1])).text; }, cid);
  assert.equal(got, "بعد التفعيل مباشرة");
  await A.evaluate(() => MPComms.connect());
});

test("accessibility: new chat screens have no serious/critical WCAG A/AA violations", async () => {
  const report = {};
  for (const r of ["#/messages", "#/chat/" + ids.dm, "#/chatinfo/" + ids.dm, "#/safety/" + ids.badr_cm, "#/devices", "#/newgroup", "#/message-requests", "#/e2ee"]) {
    await A.goto(S.base + "/?nosw" + r); await A.waitForTimeout(1200);
    await A.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    report[r] = (await A.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") }))))
      .filter(v => ["serious", "critical"].includes(v.impact));
  }
  const bad = Object.entries(report).filter(([, v]) => v.length);
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
