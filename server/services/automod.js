/* Automatic moderation (Track 7, Phase 31). Extends safety.js (reports/decisions/appeals) and cmod.js
 * (community rules) instead of replacing them:
 *  1. Arabic text classifier (lib/ar-classify.js): abuse, threats, hate, fraud — local, evasion-resistant;
 *     an optional model (ctx.llm.classify, when configured and AUTOMOD_LLM=1) refines borderline cases.
 *  2. Image screening (lib/imgscan.js): block-list hashes, metadata, skin heuristic, optional external provider.
 *  3. Malicious links (lib/linkscan.js) + an admin-managed domain list (automod_domains).
 *  4. Smart delay / quarantine instead of deletion: content becomes status 'held' (only its author sees it, with a
 *     gentle explanation); "delayed" items publish automatically after a cooling-off period unless they are
 *     reported or a deeper check raises them; "held" items wait for a moderator; "escalated" ones also open a
 *     system report so they appear in the admin dashboard and the community review queue. Editing a held post
 *     into something acceptable releases it automatically. Only a human decision removes content, and removals
 *     create a normal decision that can be appealed through /api/appeals.
 *  5. Async pipeline: a fast synchronous-ish first pass on the bus (POST_CREATED/COMMENT_CREATED/POST_UPDATED/
 *     MESSAGE_SENT), then a durable "automod.deep" job on ctx.queue for images and the optional model.
 *  6. Adaptive rate limits: the shared limiter (ctx.rl) is scaled by an account trust tier (age, reputation,
 *     verification, recent strikes/holds): new accounts get tighter limits, trusted ones looser.
 *  7–8. APIs for the gentle UI (why something is hidden) and the «هل أنت متأكد؟» nudge (POST /api/automod/check;
 *     the text is classified in memory and never stored).
 * Optional zero-window hook: services/content.js can call gate() before inserting (see INTEGRATION.md). */
const fs = require("node:fs");
const { E, str, oneOf, id, now, LIMITS } = require("../lib/core");
const C = require("../lib/ar-classify");
const L = require("../lib/linkscan");
const IS = require("../lib/imgscan");

const DAY = 864e5;
const ACTIONS = ["allow", "delay", "hold", "escalate"];
/* trust tiers → rate-limit multipliers and classifier threshold shift (negative = stricter) */
const TIERS = {
  new: { label: "حساب جديد", shift: -0.1, mult: { post: 0.75, comment: 0.75, react: 0.75, upload: 0.5, follow: 0.5, message: 0.5, invite: 0.34, report: 0.5, community: 0.34 } },
  young: { label: "حساب حديث", shift: -0.05, mult: { follow: 0.75, message: 0.75, invite: 0.5, community: 0.5, upload: 0.75 } },
  standard: { label: "حساب عادي", shift: 0, mult: {} },
  trusted: { label: "حساب موثوق", shift: 0.1, mult: { post: 2, comment: 2, react: 2, upload: 2, follow: 2, message: 2, invite: 2, report: 2, community: 2 } },
  restricted: { label: "حساب تحت المراقبة", shift: -0.15, mult: { post: 0.5, comment: 0.5, react: 0.5, upload: 0.5, follow: 0.5, message: 0.5, invite: 0.34, report: 0.5, community: 0.34 } }
};
const SCOPED = new Set(["post", "comment", "react", "upload", "follow", "message", "invite", "report", "community"]);
const STATE_LABEL = { delayed: "تأخير مؤقت للمراجعة", held: "بانتظار مراجعة", escalated: "قيد المراجعة من الفريق", released: "نُشر", removed: "أُزيل", flagged: "تحذير للمستلم" };
const jp = (v) => { if (typeof v !== "string") return v ?? null; try { return JSON.parse(v); } catch { return null; } };

module.exports = (ctx) => {
  const { db, bus, rl, router: R } = ctx; const A = ctx.requireUser;
  const env = ctx.config.automodEnv || process.env;
  const enabled = () => env.AUTOMOD_ENABLED !== "0";
  const delayMs = () => Math.max(1, +(env.AUTOMOD_DELAY_MIN || 10)) * 60e3;
  const isAdmin = (u) => (u?.role === "admin");
  const admin = (fn) => A(async (req, res) => { if (!isAdmin(req.actor || req.user)) throw E.forbid("للإدارة فقط"); return fn(req, res); });

  /* ---------- block lists (cached a minute) ---------- */
  let lists = null, listsAt = 0;
  async function getLists() {
    if (lists && Date.now() - listsAt < 60e3) return lists;
    const d = await db.all("SELECT domain, verdict FROM automod_domains");
    const h = await db.all("SELECT hash, kind FROM automod_hashes");
    lists = { bad: d.filter(x => x.verdict === "bad").map(x => x.domain), ok: d.filter(x => x.verdict === "ok").map(x => x.domain), sha: h.filter(x => x.kind === "sha256").map(x => x.hash), ahash: h.filter(x => x.kind === "ahash").map(x => x.hash) };
    listsAt = Date.now(); return lists;
  }
  const dropLists = () => { lists = null; };

  /* ---------- trust tiers + adaptive rate limits ---------- */
  const tiers = new Map(), inflight = new Set();
  async function tierFor(uid) {
    const c = tiers.get(uid); if (c && Date.now() - c.at < 10 * 60e3) return c;
    const u = uid && await db.get("SELECT id, created_at, reputation, verified, role FROM users WHERE id=$1", [uid]);
    if (!u) { const t = { name: "standard", ...TIERS.standard, at: Date.now(), unknown: true }; tiers.set(uid, t); return t; }
    const age = (Date.now() - new Date(u.created_at).getTime()) / DAY;
    const since30 = new Date(Date.now() - 30 * DAY).toISOString(), since7 = new Date(Date.now() - 7 * DAY).toISOString();
    const strikes = Number((await db.get("SELECT COUNT(*) n FROM decisions WHERE user_id=$1 AND restored=0 AND created_at > $2", [uid, since30]))?.n || 0);
    const held = Number((await db.get("SELECT COUNT(*) n FROM automod_items WHERE author=$1 AND created_at > $2 AND state IN ('held','escalated','removed')", [uid, since7]))?.n || 0);
    let name = "standard";
    if (u.role === "admin") name = "trusted";
    else if (strikes >= 2 || held >= 3) name = "restricted";
    else if (age < 1) name = "new";
    else if (age < 7) name = "young";
    else if (u.verified || (age >= 30 && (u.reputation || 0) >= 100 && strikes === 0)) name = "trusted";
    const t = { name, ...TIERS[name], at: Date.now(), ageDays: Math.floor(age), strikes, held };
    tiers.set(uid, t); return t;
  }
  const refreshTier = (uid) => { if (inflight.has(uid)) return; inflight.add(uid); tiers.delete(uid); tierFor(uid).catch(() => { }).finally(() => inflight.delete(uid)); };
  const adaptive = env.AUTOMOD_ADAPTIVE_RL !== "0" && ctx.config.adaptiveRateLimits !== false;
  if (adaptive && rl && !rl.__automod) {
    const orig = rl.hit.bind(rl);
    rl.__automod = true;
    rl.hit = (action, key) => {
      if (!SCOPED.has(action) || typeof key !== "string" || key.includes(":")) return orig(action, key);
      const t = tiers.get(key);
      if (!t || Date.now() - t.at > 10 * 60e3) refreshTier(key);
      const m = t?.mult?.[action] ?? 1;
      if (m === 1) return orig(action, key);
      const [max, ms] = LIMITS[action] || LIMITS.default, eff = Math.max(1, Math.round(max * m)), k = action + ":" + key, ts = Date.now();
      const arr = (rl.w.get(k) || []).filter(x => ts - x < ms);
      if (arr.length >= eff) { rl.w.set(k, arr); if (arr.length === eff) bus.emit("ABUSE_DETECTED", { action, key, tier: t.name }); return false; }
      arr.push(ts); rl.w.set(k, arr); return true;
    };
  }
  bus.on("USER_REGISTERED", (e) => { const uid = e.user?.id || e.user || e.actor; if (typeof uid === "string") tiers.set(uid, { name: "new", ...TIERS.new, at: Date.now(), ageDays: 0, strikes: 0, held: 0 }); });

  /* ---------- assessment ---------- */
  /**
   * @param {{ text?: string, doc?: any, author?: string|null }} o
   */
  async function assess({ text = "", doc = null, author = null }) {
    const cls = C.classify(text), lst = await getLists();
    const links = L.scan(text, doc, { bad: lst.bad, allow: lst.ok });
    const tier = author ? await tierFor(author) : { name: "standard", ...TIERS.standard };
    const reasons = [...cls.reasons];
    let risk = cls.score;
    if (links.verdict !== "ok") { reasons.push("link"); risk = Math.max(risk, Math.round(links.risk * 0.9 * 100) / 100); }
    if (cls.categories.fraud >= 0.3 && links.count) risk = Math.max(risk, Math.min(1, cls.categories.fraud + 0.2));
    if ((tier.name === "new" || tier.name === "young") && links.risk >= 0.3) { reasons.push("account"); risk = Math.min(1, risk + 0.1); }
    risk = Math.round(risk * 100) / 100;
    const k = cls.categories;
    const severe = k.threat >= 0.8 || k.hate >= 0.75 || k.fraud >= 0.8 || links.links.some(l => l.codes.includes("known_bad") || l.codes.includes("script"));
    const s = tier.shift || 0;
    const action = severe || risk >= 0.85 + s ? "escalate" : risk >= 0.7 + s ? "hold" : risk >= 0.5 + s ? "delay" : "allow";
    return {
      action, risk, tier: tier.name, reasons: [...new Set(reasons)], explanations: C.explain(reasons),
      classification: { score: cls.score, categories: k, terms: cls.hits.map(h => ({ cat: h.cat, term: h.term })), hostile: cls.hostile, targeted: cls.targeted },
      links: links.links.filter(l => l.verdict !== "ok").map(l => ({ url: l.url.slice(0, 300), host: l.host, risk: l.risk, verdict: l.verdict, reasons: l.reasons, codes: l.codes }))
    };
  }

  /* ---------- items ---------- */
  async function itemFor(kind, tid) { const r = await db.get("SELECT * FROM automod_items WHERE target_kind=$1 AND target_id=$2", [kind, tid]); return r ? { ...r, categories: jp(r.categories), reasons: jp(r.reasons) || [], signals: jp(r.signals) || {} } : null; }
  const stateFor = (action) => ({ delay: "delayed", hold: "held", escalate: "escalated" })[action];
  async function systemReport(kind, tid, why) {
    if (await db.get("SELECT 1 x FROM reports WHERE target=$1 AND by_user='system' AND status='open'", [tid])) return;
    await db.run("INSERT INTO reports(id,target,kind,reason,by_user,status,created_at) VALUES($1,$2,$3,$4,'system','open',$5)", [id("rp"), tid, kind, ("إشراف آلي: " + why).slice(0, 200), now()]);
  }
  const why = (v) => (v.explanations || []).join(" ") || "محتوى مشبوه";
  async function tell(author, item, kind) {
    if (!author) return;
    ctx.realtime?.send?.(author, "automod", { target: item.target_id, kind: item.target_kind, state: item.state, explanations: C.explain(item.reasons || []) });
    try { await ctx.services.notify?.notify?.(author, kind, { ref: item.target_id }); } catch { /* notifications are best effort */ }
  }

  /** move one post/comment into quarantine (never deletes); records or upgrades its automod item */
  async function quarantine(kind, row, v, source, prevOverride) {
    const state = stateFor(v.action); if (!state) return null;
    const existing = await itemFor(kind, row.id);
    const order = { delayed: 1, held: 2, escalated: 3 };
    if (existing && ["held", "delayed", "escalated"].includes(existing.state) && order[existing.state] >= order[state]) return existing;
    const table = kind === "post" ? "posts" : "comments";
    let prev = prevOverride || existing?.prev_status || row.status;
    if (["removed", "deleted"].includes(row.status)) return null;
    if (row.status !== "held") {
      const r = await db.run(`UPDATE ${table} SET status='held' WHERE id=$1 AND status=$2`, [row.id, row.status]);
      if (!r.changes) return null;
    } else if (!existing && !prevOverride) prev = "published";
    const at = now(), signals = { ...(existing?.signals || {}), links: v.links, terms: v.classification?.terms, tier: v.tier, ...(v.extra || {}) };
    const releaseAt = state === "delayed" ? new Date(Date.now() + delayMs()).toISOString() : null;
    const community = kind === "post" ? row.community || null : (await db.get("SELECT p.community FROM comments c JOIN posts p ON p.id=c.post WHERE c.id=$1", [row.id]))?.community || null;
    if (existing) await db.run("UPDATE automod_items SET state=$1, score=$2, categories=$3, reasons=$4, signals=$5, release_at=$6, updated_at=$7, prev_status=$8 WHERE id=$9", [state, Math.max(v.risk, existing.score || 0), v.classification?.categories || existing.categories, [...new Set([...(existing.reasons || []), ...v.reasons])], signals, releaseAt, at, prev, existing.id]);
    else await db.run("INSERT INTO automod_items(id,target_kind,target_id,author,community,state,prev_status,score,categories,reasons,signals,source,release_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)", [id("am"), kind, row.id, row.author, community, state, prev, v.risk, v.classification?.categories || {}, v.reasons, signals, source, releaseAt, at]);
    if (state === "escalated") await systemReport(kind, row.id, why(v));
    const item = await itemFor(kind, row.id);
    await ctx.audit("AUTOMOD_" + state.toUpperCase(), row.id, `${kind} ${v.reasons.join(",")} ${Math.round(v.risk * 100)}%`, "system");
    bus.emit("CONTENT_HELD", { kind, target: row.id, author: row.author, state, reasons: v.reasons });
    if (row.author) tiers.delete(row.author);
    ctx.cache?.del?.("feed:");
    await tell(row.author, item, "automod_held");
    return item;
  }

  /** release a held item back to its previous state (author edit, timer, moderator, deep check) */
  async function release(item, by = "system", note = null) {
    if (!["held", "delayed", "escalated"].includes(item.state)) return false;
    const table = item.target_kind === "post" ? "posts" : "comments";
    let prev = item.prev_status || "published";
    if (item.target_kind === "comment" || !["published", "processing", "scheduled", "pending"].includes(prev)) prev = "published";
    const r = await db.run(`UPDATE ${table} SET status=$1 WHERE id=$2 AND status='held'`, [prev, item.target_id]);
    await db.run("UPDATE automod_items SET state='released', decided_by=$1, decided_at=$2, note=$3, updated_at=$2, release_at=NULL WHERE id=$4", [by, now(), note, item.id]);
    if (by !== "system") await db.run("UPDATE reports SET status='dismissed', resolved_by=$1, resolved_at=$2 WHERE target=$3 AND by_user='system' AND status='open'", [by, now(), item.target_id]);
    if (r.changes && item.target_kind === "post") {
      const row = await db.get("SELECT * FROM posts WHERE id=$1", [item.target_id]);
      if (prev === "processing") await ctx.services.media?.finishMediaPost?.(item.target_id);
      else if (prev === "published" && item.source === "precheck") bus.emit("POST_PUBLISHED", { post: row });
    }
    await ctx.audit("AUTOMOD_RELEASED", item.target_id, note || by, by);
    ctx.cache?.del?.("feed:");
    await tell(item.author, { ...item, state: "released", reasons: [] }, "automod_released");
    return true;
  }

  /** moderator removal: reuses the decisions/appeals model of safety.js */
  async function remove(item, by, reason) {
    const table = item.target_kind === "post" ? "posts" : "comments";
    if (item.target_kind === "post") await db.run("UPDATE posts SET status='removed', moderation='removed' WHERE id=$1", [item.target_id]);
    else await db.run(`UPDATE ${table} SET status='removed' WHERE id=$1`, [item.target_id]);
    const did = id("dc"), text = reason || why({ explanations: C.explain(item.reasons || []) });
    await db.run("INSERT INTO decisions(id,target,user_id,action,reason,by_user,created_at) VALUES($1,$2,$3,'REMOVED',$4,$5,$6)", [did, item.target_id, item.author, text.slice(0, 300), by, now()]);
    await db.run("UPDATE reports SET status='actioned', resolved_by=$1, resolved_at=$2 WHERE target=$3 AND status='open'", [by, now(), item.target_id]);
    await db.run("UPDATE automod_items SET state='removed', decided_by=$1, decided_at=$2, note=$3, updated_at=$2, release_at=NULL WHERE id=$4", [by, now(), reason, item.id]);
    bus.emit("CONTENT_REMOVED", { post: item.target_kind === "post" ? item.target_id : null, user: item.author, decision: did });
    await ctx.audit("CONTENT_REMOVED", item.target_id, "automod: " + text, by);
    if (item.author) tiers.delete(item.author);
    ctx.cache?.del?.("feed:");
    return did;
  }
  async function escalate(item, by, note) {
    await db.run("UPDATE automod_items SET state='escalated', release_at=NULL, decided_by=$1, note=$2, updated_at=$3 WHERE id=$4", [by, note, now(), item.id]);
    await systemReport(item.target_kind, item.target_id, note || why({ explanations: C.explain(item.reasons || []) }));
  }

  /* ---------- optional zero-window gate (called by content.js before INSERT, see INTEGRATION.md) ---------- */
  const gated = new Map();
  /** @returns {Promise<string>} the status to insert: 'held' when the content must wait, otherwise `status` */
  async function gate(user, { kind = "post", id: tid, text = "", doc = null, status = "published" }) {
    if (!enabled() || !tid || isAdmin(user) || !["published", "processing", "scheduled"].includes(status)) return status;
    const v = await assess({ text, doc, author: user.id });
    if (v.action === "allow") return status;
    gated.set(kind + ":" + tid, { v, prev: status, at: Date.now() });
    setTimeout(() => gated.delete(kind + ":" + tid), 60e3).unref?.();
    return "held";
  }

  /* ---------- first pass on the bus ---------- */
  const mediaKeys = (data) => {
    const d = data || {}, out = [];
    for (const m of [d.media, d.cover, ...(Array.isArray(d.images) ? d.images : [])]) if (typeof m === "string" && m.startsWith("/media/")) out.push(m.slice(7));
    return [...new Set(out)].slice(0, 10);
  };
  const llmOn = () => env.AUTOMOD_LLM === "1" && typeof ctx.llm?.classify === "function";
  async function scanPost(row, { edited = false } = {}) {
    if (!enabled() || !row || ["deleted", "removed", "draft", "archived"].includes(row.status)) return null;
    if (row.status === "pending") return null; // community review queue (cmod) already owns it
    const author = await db.get("SELECT role FROM users WHERE id=$1", [row.author]);
    if (isAdmin(author)) return null;
    const g = gated.get("post:" + row.id); if (g) gated.delete("post:" + row.id);
    const v = g?.v || await assess({ text: `${row.title || ""} ${row.text || ""}`, doc: row.data?.doc, author: row.author });
    const existing = await itemFor("post", row.id);
    let item = existing;
    if (edited && existing && ["held", "delayed", "escalated"].includes(existing.state) && existing.state !== "escalated" && v.action === "allow" && !(existing.reasons || []).includes("image")) {
      await release(existing, "author_edit", "عدّله صاحبه"); return { action: "released" };
    }
    if (v.action !== "allow") item = await quarantine("post", row, v, g ? "precheck" : "scan", g?.prev);
    else if (row.status === "held" && !existing) item = await quarantine("post", row, { ...v, action: "delay" }, "precheck", "published"); // gated earlier, verdict expired: short delay, never stuck
    if (!edited && (mediaKeys(row.data).length || (llmOn() && v.risk >= 0.35))) await ctx.queue.enqueue("automod.deep", { kind: "post", id: row.id });
    else if (edited && llmOn() && v.risk >= 0.35) await ctx.queue.enqueue("automod.deep", { kind: "post", id: row.id });
    return { action: v.action, item };
  }
  async function scanComment(cid) {
    if (!enabled()) return null;
    const c = await db.get("SELECT c.*, u.role FROM comments c JOIN users u ON u.id=c.author WHERE c.id=$1", [cid]); if (!c || isAdmin(c)) return null;
    const g = gated.get("comment:" + cid); if (g) gated.delete("comment:" + cid);
    const v = g?.v || await assess({ text: c.text, author: c.author });
    let item = null;
    if (v.action !== "allow") item = await quarantine("comment", c, v, g ? "precheck" : "scan", g?.prev);
    if (llmOn() && v.risk >= 0.35) await ctx.queue.enqueue("automod.deep", { kind: "comment", id: cid });
    return { action: v.action, item };
  }
  /* private messages are never hidden (privacy): dangerous links/scams are flagged to the recipients instead */
  async function scanMessage(mid) {
    if (!enabled()) return null;
    const m = await db.get("SELECT id, conv, sender, text FROM messages WHERE id=$1", [mid]); if (!m?.text) return null;
    const v = await assess({ text: m.text, author: m.sender });
    const k = v.classification.categories;
    if (!(v.links.length && v.links.some(l => l.risk >= 0.3)) && k.fraud < 0.5 && k.threat < 0.8) return null;
    await db.run("INSERT INTO automod_items(id,target_kind,target_id,author,state,score,categories,reasons,signals,source,created_at,updated_at) VALUES($1,'message',$2,$3,'flagged',$4,$5,$6,$7,'scan',$8,$8) ON CONFLICT (target_kind,target_id) DO NOTHING", [id("am"), m.id, m.sender, v.risk, k, v.reasons, { links: v.links, conv: m.conv }, now()]);
    const to = (await db.all("SELECT user_id FROM conversation_members WHERE conv=$1 AND user_id<>$2", [m.conv, m.sender])).map(x => x.user_id);
    for (const u of to) ctx.realtime?.send?.(u, "automod_flag", { conv: m.conv, message: m.id, explanations: v.explanations, links: v.links.map(l => ({ host: l.host, reasons: l.reasons })) });
    return { action: "flag", to };
  }
  const safe = (fn) => (e) => Promise.resolve().then(() => fn(e)).catch(err => console.error("[automod]", err.message));
  bus.on("POST_CREATED", safe(e => e.post && scanPost(e.post)));
  bus.on("POST_UPDATED", safe(async e => scanPost(await db.get("SELECT * FROM posts WHERE id=$1", [e.post]), { edited: true })));
  bus.on("COMMENT_CREATED", safe(e => scanComment(e.comment)));
  bus.on("MESSAGE_SENT", safe(e => scanMessage(e.message)));

  /* ---------- second pass: durable job (images, optional model) ---------- */
  async function readMedia(key) {
    const m = ctx.services.media;
    if (m?.ensureLocal) { const f = await m.ensureLocal(key).catch(() => null); if (f && fs.existsSync(f)) return fs.readFileSync(f); }
    if (ctx.storage?.get) return ctx.storage.get(key).catch(() => null);
    return null;
  }
  async function deep({ kind, id: tid }) {
    const row = kind === "post" ? await db.get("SELECT * FROM posts WHERE id=$1", [tid]) : await db.get("SELECT * FROM comments WHERE id=$1", [tid]);
    if (!row || ["deleted", "removed"].includes(row.status)) return;
    const extra = {}; let raise = null, sensitive = false;
    if (kind === "post") {
      const lst = await getLists(), images = [];
      for (const key of mediaKeys(row.data)) {
        const buf = await readMedia(key); if (!buf) continue;
        const r = await IS.screen(buf, { blockSha: lst.sha, blockHashes: lst.ahash, env });
        images.push({ key, score: r.score, reasons: r.reasons, ahash: r.ahash, skin: r.skin, provider: r.provider ? { score: r.provider.score ?? null } : null });
        if (r.sensitive) sensitive = true;
        if (r.hold) raise = "escalate";
      }
      if (images.length) extra.images = images;
      if (sensitive && !row.sensitive) await db.run("UPDATE posts SET sensitive=1 WHERE id=$1", [tid]);
    }
    if (llmOn()) {
      try {
        const text = kind === "post" ? `${row.title || ""} ${row.text || ""}` : row.text;
        const r = await ctx.llm.classify({ text: String(text).slice(0, 4000), labels: ["abuse", "threat", "hate", "fraud"], lang: "ar" });
        const s = typeof r?.score === "number" ? r.score : Math.max(0, ...Object.values(r?.categories || {}).map(Number).filter(n => !isNaN(n)));
        extra.llm = { score: Math.round(s * 100) / 100, provider: r?.provider || ctx.llm.active || null };
        if (s >= 0.85) raise = "escalate"; else if (s >= 0.7 && !raise) raise = "hold";
      } catch (e) { extra.llm = { error: true }; }
    }
    const item = await itemFor(kind, tid);
    if (raise) {
      const reasons = [...(item?.reasons || []), ...(extra.images?.some(i => i.reasons.length) ? ["image"] : [])];
      await quarantine(kind, row, { action: raise, risk: Math.max(item?.score || 0, 0.85), reasons: reasons.length ? reasons : ["abuse"], explanations: C.explain(reasons), classification: { categories: item?.categories || {} }, links: item?.signals?.links || [], extra }, "deep");
    } else if (item && ["delayed", "held"].includes(item.state)) {
      await db.run("UPDATE automod_items SET signals=$1, updated_at=$2 WHERE id=$3", [{ ...(item.signals || {}), ...extra }, now(), item.id]);
      if (item.state === "delayed" && extra.llm && extra.llm.score < 0.3) await release(item, "system", "أكد الفحص العميق سلامته");
    } else if (extra.images?.length) {
      // keep the screening record for transparency even when nothing was held
      if (!item) await db.run("INSERT INTO automod_items(id,target_kind,target_id,author,state,score,categories,reasons,signals,source,created_at,updated_at) VALUES($1,$2,$3,$4,'cleared',$5,$6,$7,$8,'deep',$9,$9) ON CONFLICT (target_kind,target_id) DO NOTHING", [id("am"), kind, tid, row.author, Math.max(0, ...extra.images.map(i => i.score)), {}, sensitive ? ["image"] : [], extra, now()]);
    }
  }
  ctx.queue.on("automod.deep", deep);

  /* ---------- smart delay: release or escalate when the cooling-off period ends ---------- */
  async function releaseDue() {
    const due = await db.all("SELECT * FROM automod_items WHERE state='delayed' AND release_at <= $1 ORDER BY release_at LIMIT 200", [now()]);
    let released = 0, escalated = 0;
    for (const r of due) {
      const item = { ...r, reasons: jp(r.reasons) || [], signals: jp(r.signals) || {} };
      const reports = Number((await db.get("SELECT COUNT(*) n FROM reports WHERE target=$1 AND by_user<>'system' AND status='open'", [item.target_id]))?.n || 0);
      if (reports) { await escalate(item, "system", "وصلت بلاغات أثناء فترة التأخير"); escalated++; }
      else if (await release(item, "system", "انتهت فترة التأخير دون بلاغات")) released++;
    }
    return { released, escalated };
  }
  ctx.scheduler.every("automodRelease", 60e3, releaseDue);

  /* ---------- presenting items ---------- */
  async function present(r, { forAdmin = false } = {}) {
    const reasons = jp(r.reasons) || [], signals = jp(r.signals) || {};
    let preview = null;
    if (r.target_kind === "post") { const p = await db.get("SELECT title, text, status FROM posts WHERE id=$1", [r.target_id]); preview = p ? ((p.title ? p.title + " — " : "") + (p.text || "")).slice(0, 280) : null; }
    else if (r.target_kind === "comment") { const c = await db.get("SELECT text, post FROM comments WHERE id=$1", [r.target_id]); preview = c?.text?.slice(0, 280) || null; }
    const out = {
      id: r.id, kind: r.target_kind, target: r.target_id, state: r.state, stateLabel: STATE_LABEL[r.state] || r.state, createdAt: r.created_at, releaseAt: r.release_at || null,
      reasons, explanations: C.explain(reasons), preview,
      help: r.state === "delayed" ? "سيُنشر تلقائياً بعد فترة قصيرة إن لم تصل بلاغات. يمكنك تعديله الآن إن أردت." : ["held", "escalated"].includes(r.state) ? "يمكنك تعديله ليُعاد فحصه فوراً، أو انتظار مراجعة الفريق. لن يُحذف دون مراجعة بشرية." : r.state === "removed" ? "أُزيل بعد مراجعة بشرية، ويمكنك تقديم استئناف." : null,
      links: (signals.links || []).map(l => ({ host: l.host, reasons: l.reasons }))
    };
    if (forAdmin) Object.assign(out, { author: r.author, community: r.community, score: r.score, categories: jp(r.categories), signals, source: r.source, decidedBy: r.decided_by, note: r.note });
    return out;
  }

  /* ---------- routes ---------- */
  /* 8. «هل أنت متأكد؟» — lightweight check before posting a reply; nothing is stored */
  R.post("/api/automod/check", A(async (req) => {
    if (!rl.hit("default", "amcheck:" + req.user.id)) throw E.rate();
    const text = str(req.body.text, 5000) || "";
    const cls = C.classify(text), lst = await getLists(), links = L.scan(text, null, { bad: lst.bad, allow: lst.ok });
    const k = cls.categories, top = Math.max(k.abuse, k.threat, k.hate);
    const level = top >= 0.7 || k.threat >= 0.6 ? "strong" : cls.hostile ? "gentle" : links.verdict === "malicious" || k.fraud >= 0.6 ? "risky" : "none";
    const msg = {
      strong: "قد يجرح هذا الرد شخصاً حقيقياً، وقد يُخفى حتى تتم مراجعته. هل تودّ إعادة صياغته؟",
      gentle: "يبدو ردّك حادّاً بعض الشيء. هل تودّ مراجعته قبل النشر؟",
      risky: "يحتوي النص على ما يشبه الاحتيال أو رابطاً غير آمن، وقد يُؤخَّر نشره للمراجعة.",
      none: null
    }[level];
    return { nudge: level !== "none", level, message: msg, explanations: C.explain([...cls.reasons, ...(links.verdict !== "ok" ? ["link"] : [])]), categories: k, terms: cls.hits.slice(0, 5).map(h => h.term) };
  }));
  R.post("/api/automod/nudge", A(async (req) => {
    const outcome = oneOf(req.body.outcome, ["edited", "posted", "cancelled"], null), level = oneOf(req.body.level, ["gentle", "strong", "risky"], null);
    if (!outcome || !level) throw E.bad();
    if (!rl.hit("default", "amnudge:" + req.user.id)) throw E.rate();
    await db.run("INSERT INTO automod_nudges(id,user_id,level,outcome,created_at) VALUES($1,$2,$3,$4,$5)", [id("an"), req.user.id, level, outcome, now()]);
    return { ok: true };
  }));
  /* 7. gentle explanations for the author */
  R.get("/api/automod/mine", A(async (req) => ({ items: await Promise.all((await db.all("SELECT * FROM automod_items WHERE author=$1 AND target_kind IN ('post','comment') AND state IN ('delayed','held','escalated','removed') ORDER BY created_at DESC LIMIT 50", [req.user.id])).map(r => present(r))) })));
  R.get("/api/automod/explain/:target", A(async (req) => {
    const r = await db.get("SELECT * FROM automod_items WHERE target_id=$1 AND target_kind IN ('post','comment')", [req.params.target]);
    if (!r || (r.author !== req.user.id && !isAdmin(req.user))) throw E.nf();
    return { item: await present(r, { forAdmin: isAdmin(req.user) }) };
  }));
  R.get("/api/automod/flags/:conv", A(async (req) => {
    if (!(await db.get("SELECT 1 x FROM conversation_members WHERE conv=$1 AND user_id=$2", [req.params.conv, req.user.id]))) throw E.nf();
    const rows = await db.all("SELECT target_id, reasons, signals FROM automod_items WHERE target_kind='message' AND state='flagged' AND target_id IN (SELECT id FROM messages WHERE conv=$1) AND author<>$2", [req.params.conv, req.user.id]);
    return { flags: rows.map(r => ({ message: r.target_id, explanations: C.explain(jp(r.reasons) || []), links: (jp(r.signals)?.links || []).map(l => ({ host: l.host, reasons: l.reasons })) })) };
  }));
  /* 6. transparency: my current limits */
  R.get("/api/automod/limits", A(async (req) => {
    tiers.delete(req.user.id); const t = await tierFor(req.user.id);
    const limits = Object.fromEntries([...SCOPED].map(a => { const [max, ms] = LIMITS[a] || LIMITS.default; return [a, { max: adaptive ? Math.max(1, Math.round(max * (t.mult[a] ?? 1))) : max, perSeconds: ms / 1000 }]; }));
    return { tier: t.name, label: t.label, adaptive, limits, note: t.name === "new" ? "الحسابات الجديدة لها حدود أهدأ تزداد تلقائياً مع الوقت والمشاركة الإيجابية." : null };
  }));

  /* admin */
  R.get("/api/admin/automod", admin(async (req) => {
    const state = oneOf(req.query.state, ["delayed", "held", "escalated", "released", "removed", "flagged", "cleared", "open"], "open");
    const rows = state === "open" ? await db.all("SELECT * FROM automod_items WHERE state IN ('delayed','held','escalated') ORDER BY score DESC, created_at LIMIT 200") : await db.all("SELECT * FROM automod_items WHERE state=$1 ORDER BY created_at DESC LIMIT 200", [state]);
    return { items: await Promise.all(rows.map(r => present(r, { forAdmin: true }))) };
  }));
  R.get("/api/admin/automod/lists", admin(async () => ({ domains: await db.all("SELECT * FROM automod_domains ORDER BY created_at DESC LIMIT 500"), hashes: await db.all("SELECT hash, kind, label, created_at FROM automod_hashes ORDER BY created_at DESC LIMIT 500"), seed: [...L.SEED_BAD] })));
  R.post("/api/admin/automod/domains", admin(async (req) => {
    const domain = L.normalizeDomain(str(req.body.domain, 253, { required: true }));
    if (!/^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(domain)) throw E.bad("نطاق غير صالح");
    const verdict = oneOf(req.body.verdict, ["bad", "ok"], "bad");
    await db.run("INSERT INTO automod_domains(domain,verdict,reason,added_by,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (domain) DO UPDATE SET verdict=$2, reason=$3, added_by=$4", [domain, verdict, str(req.body.reason, 200), req.user.id, now()]);
    dropLists(); await ctx.audit("AUTOMOD_DOMAIN_" + verdict.toUpperCase(), domain, str(req.body.reason, 200), req.user.id);
    return { domain, verdict };
  }));
  R.del("/api/admin/automod/domains/:domain", admin(async (req) => { await db.run("DELETE FROM automod_domains WHERE domain=$1", [req.params.domain]); dropLists(); return { ok: true }; }));
  /* block an image (and near-duplicates) by media id: exact SHA-256 and perceptual hash */
  R.post("/api/admin/automod/hashes", admin(async (req) => {
    const mid = str(req.body.media, 200), label = str(req.body.label, 100);
    let sha = null, ahash = null;
    if (mid) {
      const key = mid.startsWith("/media/") ? mid.slice(7) : (await db.get("SELECT storage_key FROM media WHERE id=$1", [mid]))?.storage_key || mid;
      const buf = await readMedia(key); if (!buf) throw E.nf("الصورة غير موجودة");
      const r = await IS.screen(buf, { env: {} }); sha = r.sha256; ahash = r.ahash;
    } else {
      const h = String(req.body.hash || "").toLowerCase();
      if (/^[0-9a-f]{64}$/.test(h)) sha = h; else if (/^[0-9a-f]{16}$/.test(h)) ahash = h; else throw E.bad("بصمة غير صالحة");
    }
    for (const [hash, kind] of [[sha, "sha256"], [ahash, "ahash"]]) if (hash && !(kind === "ahash" && /^(0{16}|f{16})$/.test(hash))) await db.run("INSERT INTO automod_hashes(hash,kind,label,added_by,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (hash) DO NOTHING", [hash, kind, label, req.user.id, now()]);
    dropLists(); await ctx.audit("AUTOMOD_HASH_ADDED", sha || ahash, label, req.user.id);
    return { sha256: sha, ahash };
  }));
  R.get("/api/admin/automod/stats", admin(async () => {
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const states = Object.fromEntries((await db.all("SELECT state, COUNT(*) n FROM automod_items WHERE created_at > $1 GROUP BY state", [since])).map(r => [r.state, Number(r.n)]));
    const nudges = await db.all("SELECT level, outcome, COUNT(*) n FROM automod_nudges WHERE created_at > $1 GROUP BY level, outcome", [since]);
    const shown = nudges.reduce((a, r) => a + Number(r.n), 0), reconsidered = nudges.filter(r => r.outcome !== "posted").reduce((a, r) => a + Number(r.n), 0);
    return { since, states, nudges: { shown, reconsidered, rate: shown ? Math.round(reconsidered / shown * 100) : null }, llm: llmOn(), imageProvider: !!env.AUTOMOD_IMAGE_URL, adaptiveRateLimits: adaptive };
  }));

  /* registered last: the router matches in order, and the literal admin paths above must win over :id */
  R.post("/api/admin/automod/:id", admin(async (req) => {
    const r = await db.get("SELECT * FROM automod_items WHERE id=$1", [req.params.id]); if (!r) throw E.nf();
    const item = { ...r, reasons: jp(r.reasons) || [], signals: jp(r.signals) || {} };
    const action = oneOf(req.body.action, ["release", "remove", "escalate"], null); if (!action) throw E.bad();
    const note = str(req.body.reason, 300);
    if (!["delayed", "held", "escalated"].includes(item.state)) throw E.conflict("تمت معالجة هذا العنصر");
    if (action === "release") await release(item, req.user.id, note);
    if (action === "remove") return { ok: true, decision: await remove(item, req.user.id, note) };
    if (action === "escalate") await escalate(item, req.user.id, note);
    return { ok: true };
  }));

  return { assess, gate, classify: C.classify, scanLinks: (t, d) => getLists().then(l => L.scan(t, d, { bad: l.bad, allow: l.ok })), screenImage: async (buf) => { const l = await getLists(); return IS.screen(buf, { blockSha: l.sha, blockHashes: l.ahash, env }); }, tierFor, scanPost, scanComment, scanMessage, deep, releaseDue, release, remove, itemFor, TIERS, ACTIONS };
};
