/* Pi transfers between users + payment requests (phase 56). Built on the Pi service (phase 36) and the shared ledger.
 * 1. Send: POST /api/transfers/intent {toHandle, amount, note?, requestId?} → limits/anti-fraud → Pi intent with purpose
 *    `transfer` (refId = transfer id). The sender pays the app through Pi; the money effect happens ONLY on the
 *    PI_PAYMENT_COMPLETED bus event: journal user:<sender>:pi_out → user:<recipient>:transfers (or → platform:held).
 * 2. Requests: POST /api/transfers/requests {fromHandle, amount, note?} → the payer gets a notification; payer pays it
 *    (intent with requestId) or declines; requester can cancel; open requests expire after TRANSFER_REQUEST_DAYS.
 * 3. History (sent/received, keyset cursor), receipts (participants + staff), balance of received Pi, payouts recorded by
 *    staff with the Pi txid (app→user payments are made from the app wallet outside this server; we hold no seed).
 * 4. Limits: per transfer, per day (lower for new accounts), per hour; new-account / large / integrity-limited senders are
 *    held for staff review (release → credit, reject → reversal + Pi refund record). Minors (< 18) can neither send,
 *    receive nor request; blocked pairs are refused; recipients may switch receiving off.
 * 5. Refunds (pi service admin refund → PI_PAYMENT_REFUNDED) post a reversing journal. Cancelled payments drop the transfer.
 * Off (501 not_configured) until Pi payments are enabled (PI_ENABLED=1 + PI_API_KEY), like every Pi feature. */
const { E, HttpError, str, id } = require("../lib/core");
const { toUnits, pi, ACC, createLedger } = require("../lib/ledger");
const DAY = 864e5, HOUR = 3600e3;
const OFF = "تحويلات Pi غير مفعّلة بعد — تعمل فور تفعيل مدفوعات Pi";
const ACC_TR = (uid) => `user:${uid}:transfers`, ACC_PAYOUTS = "platform:payouts";

/** @param {any} ctx @param {{ env?: Record<string, string|undefined>, now?: () => Date }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const staff = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const num = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };
  const cfg = {
    maxSingle: toUnits(num("TRANSFER_MAX_SINGLE", 100)), maxDaily: toUnits(num("TRANSFER_MAX_DAILY", 300)), maxHourly: num("TRANSFER_MAX_PER_HOUR", 10),
    newDays: num("TRANSFER_NEW_ACCOUNT_DAYS", 7), newDaily: toUnits(num("TRANSFER_NEW_ACCOUNT_DAILY", 10)),
    holdAmount: toUnits(num("TRANSFER_HOLD_AMOUNT", 50)), holdNew: env.TRANSFER_HOLD_NEW !== "0",
    reqDays: num("TRANSFER_REQUEST_DAYS", 7), reqDaily: num("TRANSFER_REQUESTS_PER_DAY", 20), reqPerPayer: num("TRANSFER_REQUESTS_PER_PAYER", 3),
    feeBps: 0 // phase 53: pricing item fee.transfers — the recipient receives amount − fee
  };
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const pis = () => ctx.services.pi;
  const on = () => { const p = pis(); if (!p?.diag) return false; const d = p.diag(); return !!(d.enabled && d.apiKeyPresent); };
  const requireOn = () => { if (!on()) throw E.off(OFF); };
  const { postJournal, reverseAll } = createLedger({ now: nowIso });
  /** recipient credit (amount − fee) + platform fee line (fee recorded on the transfer when it was created) */
  const netLines = (tr) => [{ account: ACC_TR(tr.recipient_id), userId: tr.recipient_id, credit: Number(tr.amount) - Number(tr.fee || 0) }, { account: ACC.fees, credit: Number(tr.fee || 0) }];
  const explorer = (net, txid) => txid ? `${env.PI_EXPLORER_URL || "https://blockexplorer.minepi.com"}/${net === "mainnet" ? "mainnet" : "testnet"}/tx/${encodeURIComponent(txid)}` : null;

  /* ---------- helpers ---------- */
  const handleOf = (h) => str(String(h ?? "").replace(/^@/, ""), 60, { required: true });
  const userBy = (col, v) => db.get(`SELECT id, handle, name, avatar, status, role, prefs, created_at FROM users WHERE ${col}=$1`, [v]);
  const pub = (u) => (u ? { handle: u.handle, name: u.name, avatar: u.avatar || null } : null);
  const amountOf = (v) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw E.bad("مبلغ غير صالح"); const u = toUnits(n); if (u <= 0) throw E.bad("مبلغ غير صالح"); if (u > cfg.maxSingle) throw fail(400, "transfer_max", `أعلى مبلغ للتحويل ${pi(cfg.maxSingle)} Pi`); return u; };
  async function isMinor(uid) { const m = ctx.services.minors; if (!m?.isMinorUser) return false; try { return !!(await m.isMinorUser(uid)); } catch { return false; } }
  async function blockedBetween(a, b) {
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    if ((ua?.prefs?.blocked || []).includes(b) || (ub?.prefs?.blocked || []).includes(a)) return true;
    return !!(await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null));
  }
  const receivesOff = (u) => u?.prefs?.transfers === false;
  /** shared checks for sending and requesting: other user exists + active, not self, no minors, no blocks */
  async function checkPair(me, otherHandle, { requesting = false } = {}) {
    const other = await userBy("handle", handleOf(otherHandle));
    if (!other || other.status !== "active") throw E.nf("الحساب غير موجود");
    if (other.id === me.id) throw fail(400, "self_transfer", "لا يمكنك التحويل إلى نفسك");
    if ((await isMinor(me.id)) || (await isMinor(other.id))) throw fail(403, "minor_restricted", "تحويلات Pi غير متاحة لمن هم دون ١٨ سنة");
    if (await blockedBetween(me.id, other.id)) throw fail(403, "blocked", "لا يمكن التحويل مع هذا الحساب");
    if (!requesting && receivesOff(other)) throw fail(409, "recipient_off", "هذا الحساب أوقف استقبال التحويلات");
    if (requesting && receivesOff(me)) throw fail(409, "receiving_off", "فعّل استقبال التحويلات أولاً من إعدادات التحويلات");
    return other;
  }
  const young = (u, at) => at - Date.parse(u.created_at) < cfg.newDays * DAY;
  async function sentSince(uid, sinceMs) {
    const r = await db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM pi_transfers WHERE sender_id=$1 AND created_at >= $2 AND status NOT IN ('cancelled','rejected')", [uid, new Date(sinceMs).toISOString()]);
    return { sum: Number(r.s), n: Number(r.n) };
  }
  async function checkLimits(sender, units, at) {
    const h = await sentSince(sender.id, at - HOUR);
    if (h.n >= cfg.maxHourly) throw fail(429, "transfer_hourly_limit", `الحد الأقصى ${cfg.maxHourly} تحويلات في الساعة`);
    const d = await sentSince(sender.id, at - DAY), yg = young(sender, at), cap = yg ? Math.min(cfg.newDaily, cfg.maxDaily) : cfg.maxDaily;
    if (d.sum + units > cap) throw fail(429, "transfer_daily_limit", yg ? `الحسابات الجديدة يمكنها تحويل ${pi(cap)} Pi يومياً كحد أقصى` : `تجاوزت الحد اليومي للتحويل (${pi(cap)} Pi)`);
  }
  async function holdReason(sender, units, at) {
    if (cfg.holdNew && young(sender, at)) return "new_account";
    if (cfg.holdAmount > 0 && units >= cfg.holdAmount) return "amount";
    try { if (await ctx.services.integrity?.limitOf?.(sender.id)) return "integrity_limited"; } catch { /* optional */ }
    return null;
  }
  const notify = (uid, kind, o) => ctx.services.notify?.notify?.(uid, kind, o)?.catch?.((e) => logger.warn?.("transfer notify failed", { err: e.message }));
  const HOLD_AR = { new_account: "حساب جديد", amount: "مبلغ كبير", integrity_limited: "مراجعة أمان" };

  /* ---------- 1. send ---------- */
  async function intent(user, b) {
    requireOn();
    const sender = await userBy("id", user.id);
    let request = null, recipient;
    if (b.requestId) {
      request = await db.get("SELECT * FROM pi_pay_requests WHERE id=$1", [str(String(b.requestId), 100)]);
      if (!request || request.payer_id !== user.id) throw E.nf("الطلب غير موجود");
      await expireOld();
      request = await db.get("SELECT * FROM pi_pay_requests WHERE id=$1", [request.id]);
      if (request.status !== "open") throw fail(409, "request_closed", "هذا الطلب لم يعد مفتوحاً");
      const rq = await userBy("id", request.requester_id);
      recipient = await checkPair(sender, rq?.handle || "");
    } else recipient = await checkPair(sender, b.toHandle);
    const units = request ? Number(request.amount) : amountOf(b.amount);
    if (units > cfg.maxSingle) throw fail(400, "transfer_max", `أعلى مبلغ للتحويل ${pi(cfg.maxSingle)} Pi`);
    const at = clock().getTime();
    await checkLimits(sender, units, at);
    const hold = await holdReason(sender, units, at);
    const tid = id("ptr");
    const it = await pis().createIntent(user, { amount: pi(units), memo: `تحويل إلى @${recipient.handle}`, purpose: "transfer", refId: tid });
    const note = str(b.note, 200) || (request ? request.note : null) || null;
    await db.run("INSERT INTO pi_transfers(id,sender_id,recipient_id,amount,fee,note,request_id,intent_id,status,hold_reason,created_at) VALUES($1,$2,$3,$4,$10,$5,$6,$7,'pending',$8,$9)",
      [tid, sender.id, recipient.id, units, note, request ? request.id : null, it.id, hold, new Date(at).toISOString(), Math.floor((units * cfg.feeBps) / 10000)]);
    return { intent: { id: it.id, amount: it.amount, memo: it.memo, metadata: it.metadata }, transferId: tid, held: !!hold, ...(hold ? { holdNote: "سيُراجع هذا التحويل قبل وصوله (" + HOLD_AR[hold] + ")" } : {}) };
  }
  async function onPaid(tr, piTx) {
    const t = nowIso(), held = !!tr.hold_reason;
    const moved = await db.tx(async (tx) => {
      const r = await tx.run(`UPDATE pi_transfers SET status=$1, paid_at=$2${held ? "" : ", completed_at=$2"} WHERE id=$3 AND status='pending'`, [held ? "held" : "completed", t, tr.id]);
      if (!r.changes) return false;
      await postJournal(tx, { ikey: `transfer:${tr.id}:${held ? "hold" : "credit"}`, kind: held ? "transfer_hold" : "transfer", source: "transfer", refId: tr.id, creatorId: tr.recipient_id, senderId: tr.sender_id, piTx, memo: tr.note || null,
        lines: [{ account: ACC.out(tr.sender_id), userId: tr.sender_id, debit: Number(tr.amount) }, ...(held ? [{ account: ACC.held, credit: Number(tr.amount) }] : netLines(tr))] });
      if (!held && tr.request_id) await tx.run("UPDATE pi_pay_requests SET status='paid', transfer_id=$1, responded_at=$2 WHERE id=$3 AND status='open'", [tr.id, t, tr.request_id]);
      return true;
    });
    if (!moved) return;
    if (held) { await notify(tr.sender_id, "pi_transfer_held", { ref: tr.id }); ctx.audit?.("transfer_held", tr.id, tr.hold_reason, "system"); }
    else await delivered(tr);
  }
  async function delivered(tr) {
    bus.emit("PI_TRANSFER_COMPLETED", { transfer: tr.id, sender: tr.sender_id, recipient: tr.recipient_id, amount: pi(tr.amount), actor: tr.sender_id });
    await notify(tr.recipient_id, "pi_transfer_received", { actor: tr.sender_id, ref: tr.id });
    if (tr.request_id) await notify(tr.recipient_id, "pi_request_paid", { actor: tr.sender_id, ref: tr.request_id });
  }

  /* ---------- 2. requests ---------- */
  async function expireOld() { await db.run("UPDATE pi_pay_requests SET status='expired', responded_at=$1 WHERE status='open' AND expires_at < $1", [nowIso()]); }
  const reqClient = (r, me, users) => ({ id: r.id, amount: pi(r.amount), note: r.note || "", status: r.status, createdAt: r.created_at, expiresAt: r.expires_at, respondedAt: r.responded_at || null, transferId: r.transfer_id || null,
    direction: r.requester_id === me ? "out" : "in", requester: pub(users.get(r.requester_id)), payer: pub(users.get(r.payer_id)) });
  async function usersMap(ids) { const m = new Map(); for (const u of [...new Set(ids)]) m.set(u, await userBy("id", u)); return m; }
  async function createRequest(user, b) {
    requireOn();
    const me = await userBy("id", user.id), payer = await checkPair(me, b.fromHandle, { requesting: true });
    const units = amountOf(b.amount), at = clock().getTime();
    const day = await db.get("SELECT COUNT(*) n FROM pi_pay_requests WHERE requester_id=$1 AND created_at >= $2", [me.id, new Date(at - DAY).toISOString()]);
    if (Number(day.n) >= cfg.reqDaily) throw fail(429, "request_daily_limit", `الحد الأقصى ${cfg.reqDaily} طلبات في اليوم`);
    await expireOld();
    const same = await db.get("SELECT COUNT(*) n FROM pi_pay_requests WHERE requester_id=$1 AND payer_id=$2 AND status='open'", [me.id, payer.id]);
    if (Number(same.n) >= cfg.reqPerPayer) throw fail(429, "request_payer_limit", "لديك طلبات مفتوحة كثيرة لهذا الحساب");
    const rid = id("prq"), t = new Date(at).toISOString();
    await db.run("INSERT INTO pi_pay_requests(id,requester_id,payer_id,amount,note,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'open',$6,$7)", [rid, me.id, payer.id, units, str(b.note, 200) || null, t, new Date(at + cfg.reqDays * DAY).toISOString()]);
    await notify(payer.id, "pi_request_received", { actor: me.id, ref: rid });
    const r = await db.get("SELECT * FROM pi_pay_requests WHERE id=$1", [rid]);
    return { request: reqClient(r, me.id, await usersMap([me.id, payer.id])) };
  }
  async function listRequests(user, q) {
    requireOn(); await expireOld();
    const box = q.box === "out" ? "requester_id" : "payer_id";
    const args = [user.id]; let where = `${box}=$1`;
    if (q.status && ["open", "paid", "declined", "cancelled", "expired"].includes(q.status)) { args.push(q.status); where += " AND status=$2"; }
    const rows = await db.all(`SELECT * FROM pi_pay_requests WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 50`, args);
    const users = await usersMap(rows.flatMap((r) => [r.requester_id, r.payer_id]));
    const open = await db.get("SELECT COUNT(*) n FROM pi_pay_requests WHERE payer_id=$1 AND status='open'", [user.id]);
    return { items: rows.map((r) => reqClient(r, user.id, users)), openIncoming: Number(open.n) };
  }
  async function respond(user, rid, action) {
    requireOn(); await expireOld();
    const r = await db.get("SELECT * FROM pi_pay_requests WHERE id=$1", [rid]);
    if (!r || (r.payer_id !== user.id && r.requester_id !== user.id)) throw E.nf("الطلب غير موجود");
    if (action === "decline" && r.payer_id !== user.id) throw E.forbid("الرفض للطرف المطلوب منه فقط");
    if (action === "cancel" && r.requester_id !== user.id) throw E.forbid("الإلغاء لصاحب الطلب فقط");
    if (r.status !== "open") throw fail(409, "request_closed", "هذا الطلب لم يعد مفتوحاً");
    const to = action === "decline" ? "declined" : "cancelled";
    const u = await db.run("UPDATE pi_pay_requests SET status=$1, responded_at=$2 WHERE id=$3 AND status='open'", [to, nowIso(), rid]);
    if (!u.changes) throw fail(409, "request_closed", "هذا الطلب لم يعد مفتوحاً");
    if (to === "declined") await notify(r.requester_id, "pi_request_declined", { actor: user.id, ref: rid });
    return { ok: true, id: rid, status: to };
  }

  /* ---------- 3. history, receipts, balance, settings ---------- */
  const piRow = (intentId) => db.get("SELECT txid, network, status, payment_id FROM pi_transactions WHERE id=$1", [intentId]);
  async function trClient(tr, me, users) {
    const p = tr.intent_id ? await piRow(tr.intent_id) : null, out = tr.sender_id === me;
    return { id: tr.id, direction: out ? "out" : "in", amount: pi(tr.amount), note: tr.note || "", status: tr.status, holdReason: out ? tr.hold_reason || null : null,
      createdAt: tr.created_at, completedAt: tr.completed_at || null, requestId: tr.request_id || null,
      sender: pub(users.get(tr.sender_id)), recipient: pub(users.get(tr.recipient_id)), txid: p?.txid || null, network: p?.network || null, explorerUrl: explorer(p?.network, p?.txid) };
  }
  const cursorOf = (t) => Buffer.from(t.created_at + "|" + t.id).toString("base64url");
  const parseCursor = (c) => { if (!c) return null; try { const [at, i] = Buffer.from(String(c), "base64url").toString().split("|"); if (!at || !i || isNaN(Date.parse(at))) throw 0; return { at, id: i }; } catch { throw E.bad("مؤشر غير صالح"); } };
  async function history(user, q) {
    requireOn();
    const limit = Math.min(50, Math.max(1, +q.limit || 20)), c = parseCursor(q.cursor);
    // the recipient never sees a transfer before it is paid (pending/cancelled are the sender's business)
    const mine = q.box === "sent" ? "sender_id=$1" : q.box === "received" ? "recipient_id=$1 AND status IN ('held','completed','refunded')" : "(sender_id=$1 OR (recipient_id=$1 AND status IN ('held','completed','refunded')))";
    const args = [user.id]; let where = mine;
    if (c) { args.push(c.at, c.id); where += " AND (created_at < $2 OR (created_at = $2 AND id < $3))"; }
    const rows = await db.all(`SELECT * FROM pi_transfers WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`, args);
    const more = rows.length > limit, page = rows.slice(0, limit);
    const users = await usersMap(page.flatMap((r) => [r.sender_id, r.recipient_id]));
    const items = []; for (const r of page) items.push(await trClient(r, user.id, users));
    return { items, nextCursor: more ? cursorOf(page[page.length - 1]) : null, balance: await balanceOf(user.id) };
  }
  async function receipt(user, tid) {
    requireOn();
    const tr = await db.get("SELECT * FROM pi_transfers WHERE id=$1", [tid]);
    const visible = tr && (tr.sender_id === user.id || user.role === "admin" || (tr.recipient_id === user.id && ["held", "completed", "refunded"].includes(tr.status)));
    if (!visible) throw E.nf();
    return { receipt: await trClient(tr, user.id, await usersMap([tr.sender_id, tr.recipient_id])) };
  }
  async function balanceOf(uid) {
    const r = await db.get("SELECT COALESCE(SUM(credit),0) c, COALESCE(SUM(debit),0) d FROM ledger_entries WHERE account=$1", [ACC_TR(uid)]);
    const paid = await db.get("SELECT COALESCE(SUM(amount),0) s FROM pi_payouts WHERE user_id=$1", [uid]);
    return { available: pi(Number(r.c) - Number(r.d)), received: pi(Number(r.c)), paidOut: pi(Number(paid.s)), note: "الرصيد المستلم يُصرف إلى محفظة Pi الخاصة بك من محفظة التطبيق بعد التحقق." };
  }
  async function setSettings(user, b) {
    const u = await db.get("SELECT prefs FROM users WHERE id=$1", [user.id]);
    const prefs = { ...(u?.prefs || {}) };
    if (b.receive !== undefined) prefs.transfers = !!(b.receive === true || b.receive === 1 || b.receive === "1" || b.receive === "true");
    await db.run("UPDATE users SET prefs=$1 WHERE id=$2", [prefs, user.id]);
    return { receive: prefs.transfers !== false };
  }
  async function config(user) {
    const u = user ? await userBy("id", user.id) : null;
    return { enabled: on(), feePct: cfg.feeBps / 100, ...(on() ? {} : { note: OFF }), limits: { maxSingle: pi(cfg.maxSingle), maxDaily: pi(cfg.maxDaily), maxPerHour: cfg.maxHourly, newAccountDays: cfg.newDays, newAccountDaily: pi(cfg.newDaily), holdAmount: pi(cfg.holdAmount), requestDays: cfg.reqDays },
      ...(u ? { receive: !receivesOff(u), minor: await isMinor(u.id) } : {}) };
  }

  /* ---------- 4. staff review + payouts ---------- */
  async function heldList() {
    requireOn();
    const rows = await db.all("SELECT * FROM pi_transfers WHERE status='held' ORDER BY paid_at, created_at LIMIT 200");
    const users = await usersMap(rows.flatMap((r) => [r.sender_id, r.recipient_id]));
    return { items: rows.map((r) => ({ id: r.id, amount: pi(r.amount), holdReason: r.hold_reason, note: r.note || "", createdAt: r.created_at, paidAt: r.paid_at,
      sender: { id: r.sender_id, ...pub(users.get(r.sender_id)), joinedAt: users.get(r.sender_id)?.created_at }, recipient: { id: r.recipient_id, ...pub(users.get(r.recipient_id)) } })) };
  }
  async function release(by, tid, b) {
    requireOn();
    const tr = await db.get("SELECT * FROM pi_transfers WHERE id=$1", [tid]); if (!tr) throw E.nf();
    if (tr.status !== "held") throw E.conflict("التحويل ليس معلّقاً");
    const t = nowIso(), note = str(b.note, 300) || null;
    const moved = await db.tx(async (tx) => {
      const r = await tx.run("UPDATE pi_transfers SET status='completed', completed_at=$1, reviewed_by=$2, reviewed_at=$1, review_note=$3 WHERE id=$4 AND status='held'", [t, by.id, note, tr.id]);
      if (!r.changes) return false;
      await postJournal(tx, { ikey: `transfer:${tr.id}:release`, kind: "transfer_release", source: "transfer", refId: tr.id, creatorId: tr.recipient_id, senderId: tr.sender_id, piTx: tr.intent_id,
        lines: [{ account: ACC.held, debit: Number(tr.amount) }, ...netLines(tr)] });
      if (tr.request_id) await tx.run("UPDATE pi_pay_requests SET status='paid', transfer_id=$1, responded_at=$2 WHERE id=$3 AND status='open'", [tr.id, t, tr.request_id]);
      return true;
    });
    if (!moved) throw E.conflict("تغيّرت حالة التحويل، حدّث الصفحة");
    ctx.audit?.("transfer_release", tr.id, note, by.id);
    await delivered(tr);
    return { ok: true, id: tr.id, status: "completed" };
  }
  async function reject(by, tid, b) {
    requireOn();
    const tr = await db.get("SELECT * FROM pi_transfers WHERE id=$1", [tid]); if (!tr) throw E.nf();
    if (tr.status !== "held") throw E.conflict("التحويل ليس معلّقاً");
    const t = nowIso(), note = str(b.note, 300) || null;
    const moved = await db.tx(async (tx) => {
      const r = await tx.run("UPDATE pi_transfers SET status='rejected', reviewed_by=$1, reviewed_at=$2, review_note=$3 WHERE id=$4 AND status='held'", [by.id, t, note, tr.id]);
      if (!r.changes) return false;
      await reverseAll(tx, tr.id, "rejected");
      return true;
    });
    if (!moved) throw E.conflict("تغيّرت حالة التحويل، حدّث الصفحة");
    ctx.audit?.("transfer_reject", tr.id, note, by.id);
    let refund = null; try { refund = await pis().refund(by, tr.intent_id, { note: "رفض تحويل: " + (note || "") }); } catch (e) { logger.warn?.("transfer refund record failed", { err: e.message }); }
    await notify(tr.sender_id, "pi_transfer_rejected", { ref: tr.id });
    return { ok: true, id: tr.id, status: "rejected", refundId: refund?.refundId || null, refundNote: "أعد المبلغ إلى المرسل من محفظة التطبيق ثم سجّل رقم المعاملة في الاسترداد." };
  }
  async function payout(by, b) {
    requireOn();
    const u = await userBy("handle", handleOf(b.handle)); if (!u) throw E.nf("الحساب غير موجود");
    const units = toUnits(Number(b.amount)); if (!(units > 0)) throw E.bad("مبلغ غير صالح");
    const txid = str(b.txid, 200, { required: true }), note = str(b.note, 300) || null;
    const bal = await balanceOf(u.id); if (units > toUnits(bal.available)) throw fail(409, "insufficient_balance", "المبلغ أكبر من الرصيد المتاح");
    const pid = id("ppo"), t = nowIso();
    await db.tx(async (tx) => {
      await tx.run("INSERT INTO pi_payouts(id,user_id,amount,txid,note,by_user,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [pid, u.id, units, txid, note, by.id, t]);
      await postJournal(tx, { ikey: `payout:${pid}`, kind: "transfer_payout", source: "transfer", refId: pid, creatorId: u.id, piTx: txid, memo: note, lines: [{ account: ACC_TR(u.id), userId: u.id, debit: units }, { account: ACC_PAYOUTS, credit: units }] });
    });
    ctx.audit?.("transfer_payout", pid, txid, by.id);
    return { ok: true, id: pid, balance: await balanceOf(u.id) };
  }

  /* ---------- 5. bus: effects on Pi events only ---------- */
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => logger.error?.("transfers handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose !== "transfer") return;
    const tr = await db.get("SELECT * FROM pi_transfers WHERE intent_id=$1", [e.tx]); if (!tr) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(tr.amount)) > 1) { logger.warn?.("transfer amount mismatch; not credited", { transfer: tr.id }); return; }
    await onPaid(tr, e.tx);
  }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => { if (e.purpose === "transfer") await db.run("UPDATE pi_transfers SET status='cancelled', cancelled_at=$1 WHERE intent_id=$2 AND status='pending'", [nowIso(), e.tx]); }));
  bus.on("PI_PAYMENT_FAILED", track(async (e) => { if (e.purpose === "transfer") await db.run("UPDATE pi_transfers SET status='cancelled', cancelled_at=$1 WHERE intent_id=$2 AND status='pending'", [nowIso(), e.tx]); }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => {
    if (e.purpose !== "transfer") return;
    const tr = await db.get("SELECT * FROM pi_transfers WHERE intent_id=$1", [e.tx]); if (!tr) return;
    await db.tx(async (tx) => {
      await tx.run("UPDATE pi_transfers SET status='refunded', refunded_at=$1 WHERE id=$2 AND status IN ('completed','held')", [nowIso(), tr.id]);
      await reverseAll(tx, tr.id, "refund");
    });
  }));

  /* ---------- routes ---------- */
  R.get("/api/transfers/config", async (req) => config(req.user));
  R.put("/api/transfers/settings", A(async (req) => setSettings(req.user, req.body)));
  R.post("/api/transfers/intent", A(async (req) => intent(req.user, req.body)));
  R.get("/api/transfers", A(async (req) => history(req.user, req.query || {})));
  R.get("/api/transfers/balance", A(async (req) => { requireOn(); return balanceOf(req.user.id); }));
  R.get("/api/transfers/requests", A(async (req) => listRequests(req.user, req.query || {})));
  R.post("/api/transfers/requests", A(async (req) => createRequest(req.user, req.body)));
  R.post("/api/transfers/requests/:id/decline", A(async (req) => respond(req.user, req.params.id, "decline")));
  R.post("/api/transfers/requests/:id/cancel", A(async (req) => respond(req.user, req.params.id, "cancel")));
  R.get("/api/transfers/:id", A(async (req) => receipt(req.user, req.params.id)));
  R.get("/api/admin/transfers/held", staff(async () => heldList()));
  R.post("/api/admin/transfers/:id/release", staff(async (req) => release(req.user, req.params.id, req.body)));
  R.post("/api/admin/transfers/:id/reject", staff(async (req) => reject(req.user, req.params.id, req.body)));
  R.post("/api/admin/transfers/payouts", staff(async (req) => payout(req.user, req.body)));

  return { enabled: on, intent, createRequest, listRequests, respond, history, receipt, balanceOf, settle, cfg };
};
