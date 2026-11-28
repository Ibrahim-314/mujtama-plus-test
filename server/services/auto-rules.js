/* v2.167 «التطبيق يشتغل تلقائياً» — every decision that used to wait for an admin, made by fixed rules
 * (server/config/app-defaults.js → auto). One sweep every minute (leased scheduler job "autoRules"), also callable directly
 * (tests: sweep({ now })). Nothing here deletes member data; every decision is audited as actor "system".
 *
 * 1. Held MJT (identity checks — services/mjt-safety.js):
 *    • an earn entry waiting in mjt_reward_entries (any source, incl. mining / daily sign-in) is approved after holdReleaseHours
 *      (72) unless the member is suspended or has an open report against their account from the last restoreDays (7);
 *    • a held member transfer is sent after 72 h on the same condition; if it still cannot be sent (balance spent, recipient
 *      closed receiving, frozen wallet) it is retried each sweep and cancelled after transferHoldExpireDays (14) — nothing
 *      moved, nothing is lost.
 * 2. Content queues — automod pass + reputation level ≥ trustedLevel (3) → published at once; anything else is published
 *    after publishAfterHours (24) when nobody reported it:
 *      automod «held» posts / comments (NOT «escalated» ones: threats / severe abuse stay hidden for the author's appeal),
 *      ad campaigns in review, places pending review, job posts in review, collaboration campaigns in review,
 *      business ownership claims (granted only to a Pi-verified, non-minor account ≥ bizClaimMinAccountDays old; the oldest
 *      qualifying claim wins).
 * 3. Reports — a post or comment reported by `reports` (3) distinct accounts of level ≥ minLevel (3) is hidden (status
 *    'held', automod item source 'reports'). After restoreDays (7) it is restored and the reports dismissed — unless the
 *    report was upheld: `upholdReports` (6) distinct level ≥ 3 reporters, or its author was suspended; then it is removed
 *    with a normal moderation decision the author can appeal. Places hidden by reports come back after 7 days the same way
 *    (a «private home» report keeps them hidden). Professional reviews and professional profiles flagged by reports are decided
 *    the same way after 7 days, and so are reported job posts (upheld → removed, otherwise reopened) (v2.167). */
"use strict";
const DEF = require("../config/app-defaults");

const HOUR = 3600e3, DAY = 24 * HOUR;
const SYS = { id: "system", role: "admin", handle: "system", name: "النظام" };

/** @param {any} ctx @param {{ now?: () => Date|number, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx;
  const A = DEF.auto;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const ago = (ms, at = clock()) => new Date(at.getTime() - ms).toISOString();
  const S = () => ctx.services;
  const last = { at: null, result: null };

  const levelOf = async (uid) => (await S().repLevels?.unified?.(uid).catch(() => null))?.level || 1;
  const suspended = async (uid) => { const u = await db.get("SELECT status FROM users WHERE id=$1", [uid]); return !u || u.status !== "active"; };
  const reportedRecently = async (uid, at) => !!(await db.get("SELECT 1 x FROM reports WHERE kind='user' AND target=$1 AND status='open' AND by_user<>'system' AND created_at >= $2", [uid, ago(A.reportHide.restoreDays * DAY, at)]));
  const openReports = async (target) => Number((await db.get("SELECT COUNT(*) n FROM reports WHERE target=$1 AND by_user<>'system' AND status='open'", [target]))?.n || 0);
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { logger.warn?.("auto rule failed", { rule: label, err: e?.message }); return null; } };
  /** trusted = level ≥ trustedLevel → published at once; otherwise only after publishAfterHours */
  const due = async (author, createdAt, at) => (author && (await levelOf(author)) >= A.trustedLevel) || String(createdAt || "") <= ago(A.publishAfterHours * HOUR, at);

  /* ---------- 1. held MJT ---------- */
  async function releaseHolds(at) {
    const out = { earns: 0, transfers: 0, cancelled: 0, kept: 0 };
    const cutoff = ago(A.holdReleaseHours * HOUR, at);
    const RW = S().mjtRewards, SF = S().mjtSafety;
    if (RW) {
      const rows = await db.all("SELECT p.id, p.user_id FROM mjt_reward_entries p WHERE p.status='pending' AND p.kind='earn' AND p.decides IS NULL AND p.created_at <= $1 AND NOT EXISTS (SELECT 1 FROM mjt_reward_entries d WHERE d.decides=p.id) ORDER BY p.created_at LIMIT 200", [cutoff]);
      for (const r of rows) {
        if ((await suspended(r.user_id)) || (await reportedRecently(r.user_id, at))) { out.kept++; continue; }
        const ok = await safe("earn_release", () => RW.decide(SYS, r.id, { reason: "إفراج تلقائي بعد 72 ساعة دون بلاغ" }, true));
        if (ok) out.earns++;
      }
    }
    if (SF?.decideHold) {
      const holds = await db.all("SELECT id, from_id, created_at FROM mjt_transfer_holds WHERE status='pending' AND created_at <= $1 ORDER BY created_at LIMIT 200", [cutoff]);
      for (const h of holds) {
        if ((await suspended(h.from_id)) || (await reportedRecently(h.from_id, at))) { out.kept++; continue; }
        try { await SF.decideHold(SYS, h.id, { reason: "إرسال تلقائي بعد 72 ساعة دون بلاغ" }, true); out.transfers++; }
        catch (e) {
          if (String(h.created_at) <= ago(A.transferHoldExpireDays * DAY, at)) {
            const ok = await safe("transfer_cancel", () => SF.decideHold(SYS, h.id, { reason: "أُلغي تلقائياً: تعذّر الإرسال خلال 14 يوماً (" + String(e?.message || "").slice(0, 120) + ")" }, false));
            if (ok) out.cancelled++;
          } else out.kept++;
        }
      }
    }
    return out;
  }

  /* ---------- 2. content queues ---------- */
  async function publish(at) {
    const out = { automod: 0, ads: 0, places: 0, jobs: 0, collabs: 0, bizClaims: 0 };
    const AM = S().automod;
    if (AM?.release) {
      const items = await db.all("SELECT * FROM automod_items WHERE state='held' AND (source IS NULL OR source<>'reports') ORDER BY created_at LIMIT 200").catch(() => []);
      for (const r of items) {
        if (await openReports(r.target_id)) continue;
        if (!(await due(r.author, r.created_at, at))) continue;
        const item = { ...r, reasons: [], signals: {} };
        if (await safe("automod_release", () => AM.release(item, "system", "نُشر تلقائياً: لا بلاغات"))) out.automod++;
      }
    }
    if (S().ads?.decide) {
      for (const c of await db.all("SELECT id, advertiser_id, submitted_at, created_at FROM ad_campaigns WHERE status='in_review' ORDER BY submitted_at LIMIT 100").catch(() => [])) {
        if (!(await due(c.advertiser_id, c.submitted_at || c.created_at, at))) continue;
        if (await safe("ad_publish", () => S().ads.decide(SYS, c.id, { decision: "approve", note: "قُبل تلقائياً" }))) out.ads++;
      }
    }
    if (S().nearby?.review) {
      for (const p of await db.all("SELECT id, submitted_by, created_at FROM places WHERE status='pending' ORDER BY created_at LIMIT 100").catch(() => [])) {
        if (Number((await db.get("SELECT COUNT(*) n FROM place_reports WHERE place_id=$1", [p.id]))?.n || 0)) continue;
        if (!(await due(p.submitted_by, p.created_at, at))) continue;
        if (await safe("place_publish", () => S().nearby.review(SYS, p.id, { decision: "approve", note: "نُشر تلقائياً" }))) out.places++;
      }
    }
    if (S().jobs?.moderate) {
      for (const j of await db.all("SELECT id, poster_id, created_at FROM jobs WHERE status='review' ORDER BY created_at LIMIT 100").catch(() => [])) {
        if (await db.get("SELECT 1 x FROM job_reports WHERE job_id=$1 AND status='open'", [j.id]).catch(() => null)) continue;
        if (!(await due(j.poster_id, j.created_at, at))) continue;
        if (await safe("job_publish", () => S().jobs.moderate(SYS, j.id, { action: "approve" }))) out.jobs++;
      }
    }
    if (S().collabs?.decideCampaign) {
      for (const c of await db.all("SELECT id, brand_id, created_at FROM collab_campaigns WHERE status='review' ORDER BY created_at LIMIT 100").catch(() => [])) {
        if (!(await due(c.brand_id, c.created_at, at))) continue;
        if (await safe("collab_publish", () => S().collabs.decideCampaign(SYS, c.id, { decision: "approve" }))) out.collabs++;
      }
    }
    if (S().business?.decide) {
      const claims = await db.all("SELECT c.id, c.user_id, c.place_id, c.created_at, u.pi_uid, u.created_at ucreated, u.status ustatus FROM business_claims c JOIN users u ON u.id=c.user_id WHERE c.status='pending' ORDER BY c.created_at LIMIT 100").catch(() => []);
      const done = new Set();
      for (const c of claims) {
        if (done.has(c.place_id)) continue;
        if (!c.pi_uid || c.ustatus !== "active" || String(c.ucreated) > ago(A.bizClaimMinAccountDays * DAY, at)) continue;
        if (await S().minors?.isMinorUser?.(c.user_id).catch(() => false)) continue;
        if (!(await due(c.user_id, c.created_at, at))) continue;
        if (await safe("biz_claim", () => S().business.decide(SYS, c.id, { decision: "approve", note: "قُبل تلقائياً: حساب موثّق بـ Pi" }))) { out.bizClaims++; done.add(c.place_id); }
      }
    }
    return out;
  }

  /* ---------- 3. reports ---------- */
  async function trustedReporters(target) {
    const rows = await db.all("SELECT DISTINCT by_user FROM reports WHERE target=$1 AND status='open' AND by_user<>'system'", [target]);
    let n = 0; for (const r of rows) if ((await levelOf(r.by_user)) >= A.reportHide.minLevel) n++;
    return n;
  }
  async function reports(at) {
    const out = { hidden: 0, restored: 0, upheld: 0, places: 0 };
    const R2 = A.reportHide, nowIso = at.toISOString();
    const cands = await db.all("SELECT target, kind, COUNT(DISTINCT by_user) n FROM reports WHERE status='open' AND by_user<>'system' AND kind IN ('post','comment') GROUP BY target, kind HAVING COUNT(DISTINCT by_user) >= $1 LIMIT 200", [R2.reports]);
    for (const c of cands) {
      const table = c.kind === "post" ? "posts" : "comments";
      const row = await db.get(`SELECT id, author, status FROM ${table} WHERE id=$1`, [c.target]).catch(() => null);
      if (!row || row.status !== "published") continue;
      if (await db.get("SELECT 1 x FROM automod_items WHERE target_kind=$1 AND target_id=$2 AND state IN ('held','escalated','delayed')", [c.kind, c.target])) continue;
      if ((await trustedReporters(c.target)) < R2.reports) continue;
      const ok = await safe("report_hide", async () => {
        const u = await db.run(`UPDATE ${table} SET status='held' WHERE id=$1 AND status='published'`, [c.target]); if (!u.changes) return false;
        const exists = await db.get("SELECT id FROM automod_items WHERE target_kind=$1 AND target_id=$2", [c.kind, c.target]);
        const releaseAt = new Date(at.getTime() + R2.restoreDays * DAY).toISOString();
        if (exists) await db.run("UPDATE automod_items SET state='held', prev_status='published', source='reports', release_at=$1, updated_at=$2 WHERE id=$3", [releaseAt, nowIso, exists.id]);
        else await db.run("INSERT INTO automod_items(id,target_kind,target_id,author,state,prev_status,score,categories,reasons,signals,source,release_at,created_at,updated_at) VALUES($1,$2,$3,$4,'held','published',0,$5,$6,$7,'reports',$8,$9,$9)", ["am_r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), c.kind, c.target, row.author, {}, ["reports"], { reports: Number(c.n) }, releaseAt, nowIso]);
        await ctx.audit?.("AUTO_HIDDEN_REPORTS", c.target, `${c.n} reports`, "system");
        ctx.cache?.del?.("feed:");
        return true;
      });
      if (ok) out.hidden++;
    }
    const AM = S().automod;
    const dueItems = await db.all("SELECT * FROM automod_items WHERE state='held' AND source='reports' AND release_at <= $1 LIMIT 200", [nowIso]).catch(() => []);
    for (const r of dueItems) {
      const item = { ...r, reasons: [], signals: {} };
      const upheld = (await trustedReporters(r.target_id)) >= R2.upholdReports || (r.author && (await suspended(r.author)));
      if (upheld) { if (await safe("report_uphold", () => AM.remove(item, "system", "أُزيل تلقائياً: بلاغات مؤكَّدة من أعضاء موثوقين — يمكنك الاعتراض"))) out.upheld++; continue; }
      const ok = await safe("report_restore", async () => {
        await db.run("UPDATE reports SET status='dismissed', resolved_by='system', resolved_at=$1 WHERE target=$2 AND status='open' AND by_user<>'system'", [nowIso, r.target_id]);
        return AM.release(item, "system", "أُعيد تلقائياً: لم تتأكد البلاغات خلال 7 أيام");
      });
      if (ok) out.restored++;
    }
    if (S().nearby?.review) {
      for (const p of await db.all("SELECT id FROM places WHERE status='review' AND updated_at <= $1 LIMIT 100", [ago(R2.restoreDays * DAY, at)]).catch(() => [])) {
        const reps = await db.all("SELECT reason, COUNT(*) n FROM place_reports WHERE place_id=$1 GROUP BY reason", [p.id]);
        if (reps.some((x) => x.reason === "private") || reps.reduce((a, x) => a + Number(x.n), 0) >= R2.upholdReports) continue; // upheld: stays hidden
        if (await safe("place_restore", () => S().nearby.review(SYS, p.id, { decision: "approve", note: "أُعيد تلقائياً بعد 7 أيام" }))) out.places++;
      }
    }
    /* professional reviews flagged by reports (proreviews FLAG_AT) and professional profiles taken out of the talent
     * directory by reports (proprofile FLAG_AT): decided after restoreDays — upheld (upholdReports distinct level ≥ minLevel
     * reporters) → hidden with a note the author sees; otherwise restored and the reports dismissed */
    const trustedOf = async (rows) => { let n = 0; for (const r of rows) if ((await levelOf(r.by_user)) >= R2.minLevel) n++; return n; };
    const old = ago(R2.restoreDays * DAY, at);
    if (S().proreviews?.moderate) {
      for (const r of await db.all("SELECT id FROM pr_reviews WHERE status='flagged' AND updated_at <= $1 LIMIT 100", [old]).catch(() => [])) {
        const up = (await trustedOf(await db.all("SELECT DISTINCT by_user FROM pr_reports WHERE review_id=$1 AND status='open'", [r.id]))) >= R2.upholdReports;
        if (await safe("proreview_decide", () => S().proreviews.moderate(SYS, r.id, up ? { action: "hide", note: "أُخفي تلقائياً: بلاغات مؤكَّدة من أعضاء موثوقين" } : { action: "restore" }))) out[up ? "proReviewsHidden" : "proReviewsRestored"] = (out[up ? "proReviewsHidden" : "proReviewsRestored"] || 0) + 1;
      }
    }
    if (S().proprofile?.moderate) {
      const flagAt = S().proprofile.FLAG_AT || 3;
      for (const g of await db.all("SELECT r.user_id, u.handle, MIN(r.created_at) first FROM pro_reports r JOIN users u ON u.id=r.user_id WHERE r.status='open' GROUP BY r.user_id, u.handle HAVING COUNT(*) >= $1 LIMIT 100", [flagAt]).catch(() => [])) {
        if (String(g.first) > old) continue;
        const up = (await trustedOf(await db.all("SELECT DISTINCT by_user FROM pro_reports WHERE user_id=$1 AND status='open'", [g.user_id]))) >= R2.upholdReports;
        if (await safe("pro_decide", () => S().proprofile.moderate(SYS, g.handle, up ? { action: "hide", reason: "أُخفي تلقائياً: بلاغات مؤكَّدة من أعضاء موثوقين" } : { action: "dismiss" }))) out[up ? "proHidden" : "proRestored"] = (out[up ? "proHidden" : "proRestored"] || 0) + 1;
      }
    }
    /* job posts with open reports (paused by FLAG_AT reports, or still held for review): decided after restoreDays — upheld →
     * removed with a reason the poster sees (applications closed by the jobs service); otherwise the reports are dismissed and
     * the post reopens (a held one is then published by the content rule) */
    if (S().jobs?.moderate) {
      for (const g of await db.all("SELECT r.job_id, j.status, MIN(r.created_at) first FROM job_reports r JOIN jobs j ON j.id=r.job_id WHERE r.status='open' AND j.status IN ('paused','review') GROUP BY r.job_id, j.status HAVING j.status='review' OR COUNT(*) >= $1 LIMIT 100", [S().jobs.FLAG_AT || 3]).catch(() => [])) {
        if (String(g.first) > old) continue;
        const up = (await trustedOf(await db.all("SELECT DISTINCT by_user FROM job_reports WHERE job_id=$1 AND status='open'", [g.job_id]))) >= R2.upholdReports;
        if (await safe("job_decide", () => S().jobs.moderate(SYS, g.job_id, up ? { action: "remove", reason: "أُزيل تلقائياً: بلاغات مؤكَّدة من أعضاء موثوقين" } : { action: "dismiss" }))) out[up ? "jobsRemoved" : "jobsRestored"] = (out[up ? "jobsRemoved" : "jobsRestored"] || 0) + 1;
      }
    }
    return out;
  }

  /* ---------- catalog upkeep: new / changed paid courses ---------- */
  async function catalog() { return (await S().mjtServices?.syncCourses?.().catch(() => null)) || null; }

  async function sweep(o = {}) {
    const at = o.now ? new Date(o.now) : clock();
    const result = { at: at.toISOString(), holds: await safe("holds", () => releaseHolds(at)), content: await safe("content", () => publish(at)), reports: await safe("reports", () => reports(at)), catalog: await catalog() };
    last.at = result.at; last.result = result;
    return result;
  }
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("autoRules", A.sweepEveryMs, () => sweep());
  return { sweep, releaseHolds, publish, reports, last, SYS, rules: A };
};
