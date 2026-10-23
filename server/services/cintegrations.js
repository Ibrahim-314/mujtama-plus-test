/* Community integrations, growth helpers and «مجتمع كوين» rewards (v2.60.0, «المجتمع 3.0» stage 5).
 *  • GET /api/communities/:id/integrations — one view for the panel: installed bots (developer API, public communities only),
 *    the community's webhooks, the linked study group / courses / market listings, the Pi features (shown, OFF: «غير مفعّل بعد»)
 *    and the MJT rewards (settings, the owner's balance, today's totals, recent rewards).
 *  • Community webhooks: member.joined · post.created · report.created, signed exactly like the phase 47 developer webhooks
 *    (HMAC-SHA256 over `${t}.${body}` → `X-Mujtama-Signature: t=<ts>,v1=<hex>`, lib/devapi-lib.js), retried with the same
 *    exponential backoff, same URL policy (https + public host in production). The secret is shown once (create / rotate).
 *    Privacy: a private community's post.created carries no text (id, channel, link only); report.created never names the
 *    reporter; member.joined carries the public profile fields only.
 *  • Partner search (replaces the <select> of every community): GET …/partners/search?q=.
 *  • MJT rewards for activity in a community (a published post, an accepted answer), PAID FROM THE OWNER'S WALLET through
 *    the existing ledger (lib/mjt-ledger.js post(): double entry, idempotency key, no negative balance) — nothing is minted
 *    and the ledger is not modified. Per-member and per-community daily caps (UTC day, counting everything paid today, even
 *    if later reversed), the platform switch (MJT rewards enabled), and the transfer safety checks (minors, blocked or
 *    linked accounts, integrity flags, new accounts, receiving off, frozen wallets). When the content goes (deleted /
 *    removed / answer un-accepted) the reward is reversed back to the owner up to the member's balance (never below 0; the
 *    shortfall is recorded). A reconcile pass (nightly) reverses rewards whose content is no longer published. */
const { E, str, oneOf, id, now } = require("../lib/core");
const L = require("../lib/devapi-lib");
const CS = require("../lib/community-settings");
const M = require("../lib/mjt-ledger");
const DAY = 864e5;
const HOOK_EVENTS = { "member.joined": "انضمام عضو", "post.created": "منشور جديد", "report.created": "بلاغ جديد" };
const PI_FEATURES = [
  { key: "paidMembership", label: "عضوية مدفوعة وداعمون", desc: "اشتراك شهري بـ Pi يفتح مزايا للداعمين." },
  { key: "tips", label: "إكراميات للمشرفين والمساهمين", desc: "يرسل الأعضاء إكرامية بـ Pi لمن يساعدهم." },
  { key: "eventTickets", label: "تذاكر فعاليات بـ Pi", desc: "بيع تذاكر الفعاليات المدفوعة." },
  { key: "fund", label: "صندوق المجتمع", desc: "تبرعات بـ Pi لمصاريف المجتمع بسجل شفاف." }
];

module.exports = (ctx, opts = {}) => {
  const { db, router: R, bus, rl } = ctx; const A = ctx.requireUser; const P = ctx.cperm;
  const env = opts.env || process.env;
  const cfg = {
    backoffMs: opts.backoffMs ?? +(env.CWEBHOOK_BACKOFF_MS || 30e3), maxAttempts: +(env.CWEBHOOK_MAX_ATTEMPTS || 6), timeoutMs: +(env.CWEBHOOK_TIMEOUT_MS || 5000),
    pollMs: +(env.CWEBHOOK_POLL_MS || 15e3), maxHooks: 5,
    allowPrivate: opts.allowPrivateUrls ?? (env.DEVAPI_ALLOW_PRIVATE_URLS === "1" || env.NODE_ENV !== "production")
  };
  const getC = async (cid) => { const c = await db.get("SELECT * FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf(); return c; };
  const log = (cid, actor, o) => ctx.services.cmod.log(cid, actor, o);
  const J = (s, d = []) => { if (Array.isArray(s)) return s; try { return JSON.parse(s); } catch { return d; } };
  const n = async (sql, a) => Number((await db.get(sql, a).catch(() => null))?.n || 0);
  const pubUser = (u) => u ? { id: u.id, handle: u.handle, name: u.name } : null;
  const dayStart = () => now().slice(0, 10) + "T00:00:00.000Z";

  /* ======================= webhooks ======================= */
  const hookClient = (w, last) => ({ id: w.id, url: w.url, label: w.label || null, events: J(w.events), status: w.status, createdAt: w.created_at, last: last || null });
  async function needHooks(cid, uid) { await P.need(cid, uid, "manage_integrations", "التكاملات للمالك والمديرين"); }
  R.get("/api/communities/:id/webhooks", A(async (req) => {
    const c = await getC(req.params.id); await needHooks(c.id, req.user.id);
    const hooks = await db.all("SELECT * FROM community_webhooks WHERE community=$1 ORDER BY created_at", [c.id]);
    const last = {}; for (const d of await db.all("SELECT webhook_id, status, last_code, created_at, delivered_at FROM community_webhook_deliveries WHERE community=$1 ORDER BY created_at DESC LIMIT 200", [c.id])) if (!last[d.webhook_id]) last[d.webhook_id] = { status: d.status, code: d.last_code, at: d.delivered_at || d.created_at };
    return { webhooks: hooks.map(w => hookClient(w, last[w.id])), events: Object.entries(HOOK_EVENTS).map(([k, label]) => ({ key: k, label })), max: cfg.maxHooks };
  }));
  R.post("/api/communities/:id/webhooks", A(async (req) => {
    const c = await getC(req.params.id); await needHooks(c.id, req.user.id);
    if (!rl.hit("community", "hook:" + req.user.id)) throw E.rate();
    const url = L.checkUrl(req.body?.url, { allowPrivate: cfg.allowPrivate }); if (!url) throw E.bad("رابط Webhook غير صالح (https وعنوان عام)");
    const events = [...new Set((Array.isArray(req.body?.events) ? req.body.events : []).filter(e => HOOK_EVENTS[e]))]; if (!events.length) throw E.bad("اختر حدثاً واحداً على الأقل");
    if (await n("SELECT COUNT(*) n FROM community_webhooks WHERE community=$1", [c.id]) >= cfg.maxHooks) throw E.conflict(`الحد ${cfg.maxHooks} روابط Webhook لكل مجتمع`);
    const secret = L.secretToken("whsec_"), wid = id("cw");
    await db.run("INSERT INTO community_webhooks(id,community,url,secret,events,status,label,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'active',$6,$7,$8,$8)", [wid, c.id, url, secret, JSON.stringify(events), str(req.body?.label, 40) || null, req.user.id, now()]);
    await log(c.id, req.user.id, { action: "webhook_created", category: "integrations", reason: new URL(url).host, meta: { events } });
    return { webhook: hookClient(await db.get("SELECT * FROM community_webhooks WHERE id=$1", [wid])), secret, note: "سرّ التوقيع يظهر مرة واحدة. احفظه الآن." };
  }));
  async function myHook(req) { const c = await getC(req.params.id); await needHooks(c.id, req.user.id); const w = await db.get("SELECT * FROM community_webhooks WHERE id=$1 AND community=$2", [req.params.wid, c.id]); if (!w) throw E.nf(); return { c, w }; }
  R.patch("/api/communities/:id/webhooks/:wid", A(async (req) => {
    const { c, w } = await myHook(req), b = req.body || {};
    const events = Array.isArray(b.events) ? [...new Set(b.events.filter(e => HOOK_EVENTS[e]))] : J(w.events); if (!events.length) throw E.bad("اختر حدثاً واحداً على الأقل");
    const status = oneOf(b.status, ["active", "paused"], w.status);
    await db.run("UPDATE community_webhooks SET events=$1, status=$2, label=$3, updated_at=$4 WHERE id=$5", [JSON.stringify(events), status, b.label !== undefined ? str(b.label, 40) || null : w.label, now(), w.id]);
    await log(c.id, req.user.id, { action: "webhook_updated", category: "integrations", reason: status, meta: { events } });
    return { webhook: hookClient(await db.get("SELECT * FROM community_webhooks WHERE id=$1", [w.id])) };
  }));
  R.post("/api/communities/:id/webhooks/:wid/rotate", A(async (req) => {
    const { c, w } = await myHook(req), secret = L.secretToken("whsec_");
    await db.run("UPDATE community_webhooks SET secret=$1, updated_at=$2 WHERE id=$3", [secret, now(), w.id]);
    await log(c.id, req.user.id, { action: "webhook_rotated", category: "integrations" });
    return { secret, note: "سرّ التوقيع الجديد يظهر مرة واحدة. السرّ القديم لم يعد صالحاً." };
  }));
  R.del("/api/communities/:id/webhooks/:wid", A(async (req) => {
    const { c, w } = await myHook(req);
    await db.run("DELETE FROM community_webhooks WHERE id=$1", [w.id]);
    await log(c.id, req.user.id, { action: "webhook_deleted", category: "integrations", reason: (() => { try { return new URL(w.url).host; } catch { return null; } })() });
    return { ok: true };
  }));
  R.post("/api/communities/:id/webhooks/:wid/test", A(async (req) => { const { c, w } = await myHook(req); return { delivery: await enqueue(w, "ping", { community: { id: c.id, name: c.name } }) }; }));
  R.get("/api/communities/:id/webhooks/deliveries", A(async (req) => {
    const c = await getC(req.params.id); await needHooks(c.id, req.user.id);
    const rows = await db.all("SELECT id, webhook_id, event, status, attempts, next_at, last_code, last_error, created_at, delivered_at FROM community_webhook_deliveries WHERE community=$1 ORDER BY created_at DESC LIMIT 50", [c.id]);
    return { items: rows.map(d => ({ id: d.id, webhook: d.webhook_id, event: d.event, status: d.status, attempts: d.attempts, nextAt: d.next_at, lastCode: d.last_code, lastError: d.last_error, createdAt: d.created_at, deliveredAt: d.delivered_at })) };
  }));
  R.post("/api/communities/:id/webhooks/deliveries/:did/retry", A(async (req) => {
    const c = await getC(req.params.id); await needHooks(c.id, req.user.id);
    const d = await db.get("SELECT id FROM community_webhook_deliveries WHERE id=$1 AND community=$2", [req.params.did, c.id]); if (!d) throw E.nf();
    await db.run("UPDATE community_webhook_deliveries SET status='pending', attempts=0, next_at=$1 WHERE id=$2", [now(), d.id]);
    setImmediate(() => attempt(d.id).catch(() => {})); return { ok: true };
  }));
  async function enqueue(w, event, data) {
    const did = id("cd"), body = JSON.stringify({ id: did, event, community: w.community, createdAt: now(), data });
    await db.run("INSERT INTO community_webhook_deliveries(id,webhook_id,community,event,body,status,attempts,next_at,created_at) VALUES($1,$2,$3,$4,$5,'pending',0,$6,$6)", [did, w.id, w.community, event, body, now()]);
    setImmediate(() => attempt(did).catch(() => {}));
    return did;
  }
  async function fanout(cid, event, data) {
    for (const w of await db.all("SELECT * FROM community_webhooks WHERE community=$1 AND status='active'", [cid])) if (J(w.events).includes(event)) await enqueue(w, event, data);
  }
  const inflight = new Set();
  async function attempt(did) {
    if (inflight.has(did)) return; inflight.add(did);
    try {
      const d = await db.get("SELECT d.*, w.url, w.secret, w.status AS wstatus FROM community_webhook_deliveries d JOIN community_webhooks w ON w.id=d.webhook_id WHERE d.id=$1", [did]);
      if (!d || d.status !== "pending") return;
      const k = d.attempts + 1, ts = Math.floor(Date.now() / 1000); let code = null, err = null;
      if (d.wstatus !== "active" && d.event !== "ping") err = "webhook paused";
      else if (!L.checkUrl(d.url, { allowPrivate: cfg.allowPrivate })) err = "url not allowed";
      else {
        try {
          const res = await fetch(d.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(cfg.timeoutMs), body: d.body,
            headers: { "Content-Type": "application/json", "User-Agent": "Mujtama-Webhooks/1", "X-Mujtama-Event": d.event, "X-Mujtama-Delivery": d.id, "X-Mujtama-Community": d.community, "X-Mujtama-Signature": `t=${ts},v1=${L.sign(d.secret, ts, d.body)}` } });
          code = res.status; await res.arrayBuffer().catch(() => null);
          if (code < 200 || code >= 300) err = "HTTP " + code;
        } catch (e) { err = String(e?.name === "TimeoutError" ? "timeout" : e?.cause?.code || e?.message || e).slice(0, 200); }
      }
      if (!err) await db.run("UPDATE community_webhook_deliveries SET status='ok', attempts=$1, last_code=$2, last_error=NULL, delivered_at=$3, next_at=NULL WHERE id=$4", [k, code, now(), did]);
      else if (k >= cfg.maxAttempts || err === "webhook paused") await db.run("UPDATE community_webhook_deliveries SET status='failed', attempts=$1, last_code=$2, last_error=$3, next_at=NULL WHERE id=$4", [k, code, err, did]);
      else await db.run("UPDATE community_webhook_deliveries SET attempts=$1, last_code=$2, last_error=$3, next_at=$4 WHERE id=$5", [k, code, err, new Date(Date.now() + L.backoff(k, cfg.backoffMs)).toISOString(), did]);
    } finally { inflight.delete(did); }
  }
  async function deliverDue(limit = 50) {
    const rows = await db.all("SELECT id FROM community_webhook_deliveries WHERE status='pending' AND next_at <= $1 ORDER BY next_at LIMIT $2", [now(), limit]);
    for (const x of rows) await attempt(x.id);
    return rows.length;
  }
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("community.webhooks", cfg.pollMs, () => deliverDue());
  /* events → webhooks */
  const seen = new Set(); const first = (k) => { if (seen.has(k)) return false; seen.add(k); if (seen.size > 20000) seen.delete(seen.values().next().value); return true; };
  const quiet = (fn) => async (e) => { try { await fn(e); } catch (err) { require("../lib/log").log.warn?.("community webhook hook failed", { err: err?.message }); } };
  bus.on("COMMUNITY_MEMBER_EVENT", quiet(async (e) => {
    if (!["join", "approve"].includes(e.kind) || !first(`j:${e.community}:${e.user}:${e.at}`)) return;
    if (!(await db.get("SELECT 1 x FROM community_webhooks WHERE community=$1 AND status='active' LIMIT 1", [e.community]))) return;
    const u = await db.get("SELECT id, handle, name FROM users WHERE id=$1", [e.user]);
    await fanout(e.community, "member.joined", { member: pubUser(u), via: e.kind === "approve" ? "approval" : e.meta?.via ? "invite" : "direct", at: e.at });
  }));
  bus.on("POST_PUBLISHED", quiet(async (e) => {
    const p = e?.post?.id ? await db.get("SELECT p.id, p.community, p.channel, p.type, p.title, p.text, p.status, p.created_at, p.author, c.type ctype FROM posts p JOIN communities c ON c.id=p.community WHERE p.id=$1", [e.post.id]) : null;
    if (!p || p.status !== "published" || !first("p:" + p.id)) return;
    if (!(await db.get("SELECT 1 x FROM community_webhooks WHERE community=$1 AND status='active' LIMIT 1", [p.community]))) return;
    const u = await db.get("SELECT id, handle, name FROM users WHERE id=$1", [p.author]), origin = env.PUBLIC_URL || "";
    await fanout(p.community, "post.created", { post: { id: p.id, type: p.type, channel: p.channel || null, createdAt: p.created_at, url: `${origin}/#/post/${p.id}`, author: pubUser(u), ...(p.ctype === "public" ? { title: p.title || null, text: String(p.text || "").slice(0, 2000) } : {}) } });
  }));
  bus.on("REPORT_CREATED", quiet(async (e) => {
    if (!e?.report || !first("r:" + e.report)) return;
    const t = await db.get("SELECT p.community, 'post' kind FROM posts p WHERE p.id=$1", [e.target]) || await db.get("SELECT p.community, 'comment' kind FROM comments c JOIN posts p ON p.id=c.post WHERE c.id=$1", [e.target]).catch(() => null);
    if (!t?.community) return;
    const r = await db.get("SELECT reason, created_at FROM reports WHERE id=$1", [e.report]).catch(() => null);
    await fanout(t.community, "report.created", { report: { id: e.report, target: { kind: t.kind, id: e.target }, reason: r?.reason || null, createdAt: r?.created_at || now() } }); // never the reporter
  }));

  /* ======================= partner search (replaces the <select>) ======================= */
  R.get("/api/communities/:id/partners/search", A(async (req) => {
    const c = await getC(req.params.id); await P.need(c.id, req.user.id, "manage_integrations");
    const q = String(req.query.q || "").trim().toLowerCase().replace(/[\\%_]/g, "").slice(0, 40);
    const args = [c.id], where = ["x.id<>$1", "x.type<>'invite'", "x.archived_at IS NULL"];
    if (q) { args.push("%" + q + "%"); where.push(`(LOWER(x.name) LIKE $${args.length} OR LOWER(COALESCE(x.descr,'')) LIKE $${args.length})`); }
    const rows = await db.all(`SELECT x.id, x.name, x.descr, x.type, x.color, x.settings, x.member_count, (SELECT p.status FROM community_partners p WHERE (p.a=$1 AND p.b=x.id) OR (p.b=$1 AND p.a=x.id)) partner FROM communities x WHERE ${where.join(" AND ")} ORDER BY x.member_count DESC, x.name LIMIT 12`, args);
    return { results: rows.map(r => ({ id: r.id, name: r.name, desc: r.descr || "", type: r.type, color: r.color, icon: r.settings?.icon || null, members: Number(r.member_count || 0), partner: r.partner || null })) };
  }));

  /* ======================= «مجتمع كوين» rewards ======================= */
  const mjt = () => ctx.services.mjt;
  const rwSettings = (c) => ({ ...CS.RW_DEFAULTS, ...(c?.settings?.mjtRewards || {}) });
  async function paidToday(q, cid, uid) {
    const s = dayStart();
    const member = Number((await q.get("SELECT COALESCE(SUM(amount),0) s FROM community_mjt_rewards WHERE community=$1 AND user_id=$2 AND created_at >= $3 AND tx_id IS NOT NULL", [cid, uid, s]))?.s || 0);
    const all = Number((await q.get("SELECT COALESCE(SUM(amount),0) s FROM community_mjt_rewards WHERE community=$1 AND created_at >= $2 AND tx_id IS NOT NULL", [cid, s]))?.s || 0);
    return { member, all };
  }
  /** why this reward cannot be paid (null = it can) */
  async function blocked(c, uid) {
    const m = mjt(); if (!m) return "mjt_off";
    const S = await m.settings(); if (!S.rewards.enabled) return "rewards_off";
    if (uid === c.owner) return "self";
    const mem = await db.get("SELECT m.role, u.role urole, u.status, u.created_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.community=$1 AND m.user_id=$2", [c.id, uid]);
    if (!mem || !["member", "moderator", "admin"].includes(mem.role)) return "not_member";
    if (mem.urole === "bot" || mem.status !== "active") return "inactive";
    if (Date.now() - +new Date(mem.created_at) < S.transfers.minAccountDays * DAY) return "account_too_new";
    const g = m.guards;
    if (await g.isMinor(uid)) return "minor";
    if (await g.blockedBetween(c.owner, uid)) return "blocked";
    if (await g.linkedPair(c.owner, uid)) return "linked_accounts";
    if (await g.flagged(uid) || await g.flagged(c.owner)) return "integrity_limited";
    return null;
  }
  async function record(cid, uid, payer, kind, ref, status, reason) {
    await db.run("INSERT INTO community_mjt_rewards(id,community,user_id,payer_id,kind,ref_id,amount,status,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,$9) ON CONFLICT DO NOTHING", [id("cr"), cid, uid, payer, kind, ref, status, reason || null, now()]);
  }
  /** pay one reward (idempotent per community × kind × ref). Returns { paid, amount?, reason? } */
  async function reward(cid, uid, kind, ref) {
    const c = await db.get("SELECT id, owner, settings, archived_at FROM communities WHERE id=$1", [cid]); if (!c || c.archived_at) return { paid: false, reason: "no_community" };
    const s = rwSettings(c); if (!s.enabled) return { paid: false, reason: "off" };
    const want = kind === "answer" ? Number(s.perAnswer) : Number(s.perPost); if (!(want > 0)) return { paid: false, reason: "zero" };
    if (await db.get("SELECT 1 x FROM community_mjt_rewards WHERE community=$1 AND kind=$2 AND ref_id=$3", [cid, kind, ref])) return { paid: false, reason: "duplicate" };
    const why = await blocked(c, uid); if (why) { if (why !== "self") await record(cid, uid, c.owner, kind, ref, "skipped", why); return { paid: false, reason: why }; }
    const led = mjt().ledger, payer = M.userAcc(c.owner), acc = M.userAcc(uid);
    const out = await db.tx(async (t) => {
      const w = await led.lock(t, [payer, acc]); // user accounts sorted — the ledger's global lock order
      if (await t.get("SELECT 1 x FROM community_mjt_rewards WHERE community=$1 AND kind=$2 AND ref_id=$3", [cid, kind, ref])) return { paid: false, reason: "duplicate" };
      const rid = id("cr"), at = now();
      await t.run("INSERT INTO community_mjt_rewards(id,community,user_id,payer_id,kind,ref_id,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6,0,'pending',$7)", [rid, cid, uid, c.owner, kind, ref, at]);
      const today = await paidToday(t, cid, uid);
      const amount = Math.min(want, Math.max(0, Number(s.memberDailyCap) - today.member), Math.max(0, Number(s.communityDailyCap) - today.all));
      const skip = async (status, reason) => { await t.run("UPDATE community_mjt_rewards SET status=$1, reason=$2 WHERE id=$3", [status, reason, rid]); return { paid: false, reason }; };
      if (amount <= 0) return skip("capped", today.member >= Number(s.memberDailyCap) ? "member_daily_cap" : "community_daily_cap");
      if (w.get(payer).status !== "active") return skip("skipped", "payer_frozen");
      if (!w.get(acc).receive) return skip("skipped", "receiving_off");
      if (w.get(payer).balance < amount) return skip("unfunded", "owner_balance");
      const r = await led.post(t, { ikey: "crw:" + rid, kind: "community_reward", actorId: "system", userId: uid, otherId: c.owner, refType: "community", refId: cid, memo: `${kind}:${ref}`, lines: [{ account: payer, amount: -amount }, { account: acc, amount }] });
      await t.run("UPDATE community_mjt_rewards SET status='paid', amount=$1, tx_id=$2 WHERE id=$3", [amount, r.tx.id, rid]);
      return { paid: true, amount, capped: amount < want, txId: r.tx.id };
    });
    if (out.paid) { ctx.realtime?.send?.(uid, "mjt", { kind: "community_reward", amount: M.format(out.amount) }); try { await ctx.services.notify?.notify(uid, "mjt_received", { actor: null, ref: out.txId }); } catch { /* best effort */ } }
    return out;
  }
  /** take a paid reward back to the owner, up to the member's balance (never below 0); the shortfall is kept on the row */
  async function reverse(rowId, reason) {
    const r0 = await db.get("SELECT * FROM community_mjt_rewards WHERE id=$1", [rowId]); if (!r0 || r0.status !== "paid" || !(Number(r0.amount) > 0)) return { reversed: 0 };
    const led = mjt()?.ledger; if (!led) return { reversed: 0 };
    const payer = M.userAcc(r0.payer_id), acc = M.userAcc(r0.user_id);
    return db.tx(async (t) => {
      const w = await led.lock(t, [payer, acc]);
      const r = await t.get("SELECT * FROM community_mjt_rewards WHERE id=$1 AND status='paid'", [rowId]); if (!r) return { reversed: 0 };
      const want = Number(r.amount), back = Math.min(want, w.get(acc).balance), at = now(); let txId = null;
      if (back > 0) txId = (await led.post(t, { ikey: "crwrev:" + r.id, kind: "community_reward_reversal", actorId: "system", userId: r.user_id, otherId: r.payer_id, refType: "community", refId: r.community, reverses: r.tx_id, allowFrozen: true, memo: reason, lines: [{ account: acc, amount: -back }, { account: payer, amount: back }] })).tx.id;
      await t.run("UPDATE community_mjt_rewards SET status=$1, reversed=$2, reversal_tx_id=$3, reversed_at=$4, reason=$5 WHERE id=$6", [back === want ? "reversed" : "partially_reversed", back, txId, at, back === want ? reason : `${reason}; shortfall ${M.format(want - back)} MJT`, r.id]);
      return { reversed: back, shortfall: want - back };
    });
  }
  const rewardQuiet = (fn) => async (e) => { try { await fn(e); } catch (err) { require("../lib/log").log.warn?.("community mjt reward failed", { err: err?.message }); } };
  bus.on("POST_PUBLISHED", rewardQuiet(async (e) => {
    const p = e?.post?.id ? await db.get("SELECT id, community, author, status FROM posts WHERE id=$1", [e.post.id]) : null;
    if (p?.community && p.status === "published") await reward(p.community, p.author, "post", p.id);
  }));
  const goneContent = rewardQuiet(async (e) => {
    const pid = e?.post; if (!pid) return;
    for (const r of await db.all("SELECT id FROM community_mjt_rewards WHERE status='paid' AND ((kind='post' AND ref_id=$1) OR (kind='answer' AND ref_id IN (SELECT id FROM comments WHERE post=$1)))", [pid])) await reverse(r.id, "content_removed");
  });
  bus.on("POST_DELETED", goneContent); bus.on("CONTENT_REMOVED", goneContent);
  bus.on("ANSWER_ACCEPTED", rewardQuiet(async (e) => {
    if (!e?.community) return;
    if (e.previous) { const r = await db.get("SELECT id FROM community_mjt_rewards WHERE community=$1 AND kind='answer' AND ref_id=$2 AND status='paid'", [e.community, e.previous]); if (r) await reverse(r.id, "answer_unaccepted"); }
    if (e.comment) { const cm = await db.get("SELECT c.author, c.status, p.author pauthor FROM comments c JOIN posts p ON p.id=c.post WHERE c.id=$1", [e.comment]); if (cm && cm.status === "published" && cm.author !== cm.pauthor) await reward(e.community, cm.author, "answer", e.comment); }
  }));
  /** nightly: rewards whose content is no longer published (or no longer the accepted answer) are reversed */
  async function reconcileRewards() {
    let n2 = 0;
    for (const r of await db.all(`SELECT r.id FROM community_mjt_rewards r LEFT JOIN posts p ON r.kind='post' AND p.id=r.ref_id WHERE r.status='paid' AND r.kind='post' AND (p.id IS NULL OR p.status<>'published') LIMIT 500`)) { await reverse(r.id, "content_removed"); n2++; }
    for (const r of await db.all(`SELECT r.id, r.ref_id, c.status cstatus, p.status pstatus, p.data FROM community_mjt_rewards r LEFT JOIN comments c ON c.id=r.ref_id LEFT JOIN posts p ON p.id=c.post WHERE r.status='paid' AND r.kind='answer' LIMIT 500`)) {
      const data = typeof r.data === "string" ? (() => { try { return JSON.parse(r.data); } catch { return {}; } })() : r.data || {};
      if (r.cstatus !== "published" || r.pstatus !== "published" || data.acceptedAnswer !== r.ref_id) { await reverse(r.id, r.cstatus !== "published" || r.pstatus !== "published" ? "content_removed" : "answer_unaccepted"); n2++; }
    }
    return { reversed: n2 };
  }

  /* ======================= the integrations view ======================= */
  R.get("/api/communities/:id/integrations", A(async (req) => {
    const c = await getC(req.params.id), keys = await P.keys(c.id, req.user.id);
    if (!keys.has("manage_integrations") && !keys.has("view_analytics")) throw E.forbid("التكاملات لفريق الإدارة");
    const manage = keys.has("manage_integrations"), owner = c.owner === req.user.id, s = c.settings || {};
    const bots = c.type === "public" ? (await db.all("SELECT a.id, a.name, a.commands, u.handle, i.created_at FROM devapi_bot_installs i JOIN devapi_apps a ON a.id=i.app_id LEFT JOIN users u ON u.id=a.bot_user WHERE i.community=$1 ORDER BY i.created_at", [c.id]).catch(() => [])).map(b => ({ app: b.id, name: b.name, handle: b.handle, commands: J(b.commands).map(x => x.name).slice(0, 10), installedAt: b.created_at })) : [];
    const study = await db.get("SELECT mode, subject FROM study_groups WHERE community_id=$1", [c.id]).catch(() => null);
    const courses = await n("SELECT COUNT(*) n FROM courses WHERE community_id=$1 AND status='published'", [c.id]), drafts = await n("SELECT COUNT(*) n FROM courses WHERE community_id=$1 AND status<>'published'", [c.id]);
    const listings = await n("SELECT COUNT(*) n FROM market_listings WHERE community_id=$1 AND status='active'", [c.id]);
    const rw = rwSettings(c), led = mjt()?.ledger, today = await paidToday(db, c.id, "");
    const recent = manage ? await db.all("SELECT r.kind, r.amount, r.status, r.reason, r.created_at, r.reversed, u.name, u.handle FROM community_mjt_rewards r LEFT JOIN users u ON u.id=r.user_id WHERE r.community=$1 ORDER BY r.created_at DESC LIMIT 20", [c.id]) : [];
    const platform = mjt() ? (await mjt().settings()).rewards.enabled : false;
    return {
      community: { id: c.id, name: c.name, type: c.type }, canManage: manage, isOwner: owner,
      bots: { available: c.type === "public", items: bots, note: c.type === "public" ? null : "تُثبَّت البوتات في المجتمعات العامة فقط" },
      webhooks: manage ? (await db.all("SELECT * FROM community_webhooks WHERE community=$1 ORDER BY created_at", [c.id])).map(w => hookClient(w)) : [],
      hookEvents: Object.entries(HOOK_EVENTS).map(([k, label]) => ({ key: k, label })),
      study: { linked: !!study, mode: study?.mode || null, subject: study?.subject || null, href: study ? `#/study/${c.id}` : null },
      courses: { published: courses, drafts, href: study ? `#/study/${c.id}` : null },
      market: { listings, marketTab: !!s.marketTab, href: `#/market?community=${c.id}` },
      pi: { enabled: false, label: "غير مفعّل بعد", note: "ميزات Pi تظهر هنا وتبقى متوقفة حتى تفعيل مدفوعات Pi على المنصة.", features: PI_FEATURES.map(f => ({ ...f, enabled: false, available: false })) },
      mjt: { platformEnabled: platform, settings: CS.rewardsClient(rw), canEdit: owner, ownerBalance: owner && led ? M.format(await led.balanceOf(db, M.userAcc(c.owner))) : null,
        today: { paid: M.format(today.all), count: await n("SELECT COUNT(*) n FROM community_mjt_rewards WHERE community=$1 AND created_at >= $2 AND tx_id IS NOT NULL", [c.id, dayStart()]) },
        recent: recent.map(r => ({ kind: r.kind, amount: M.format(r.amount), status: r.status, reason: r.reason, reversed: M.format(r.reversed || 0), at: r.created_at, member: { name: r.name, handle: r.handle } })) }
    };
  }));
  /* the owner's MJT rewards settings (money of the owner: owner only — edit_settings is owner-only) */
  R.put("/api/communities/:id/mjt-rewards", A(async (req) => {
    const c = await getC(req.params.id); await P.need(c.id, req.user.id, "edit_settings", "مكافآت مجتمع كوين للمالك فقط");
    const next = CS.rewardsOf(req.body || {});
    const res = await CS.mutate(db, c.id, async (s) => ({ ...s, mjtRewards: next }));
    await log(c.id, req.user.id, { action: "settings_updated", category: "settings", reason: "rewards", diff: CS.diff({ mjtRewards: res.before.mjtRewards }, { mjtRewards: res.after.mjtRewards }) });
    return { settings: CS.rewardsClient(next) };
  }));

  return { reward, reverse, reconcileRewards, deliverDue, attempt, enqueue, fanout, cfg, HOOK_EVENTS, PI_FEATURES };
};
