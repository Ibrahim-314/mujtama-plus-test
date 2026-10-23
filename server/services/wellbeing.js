/* Digital wellbeing (phase 45) — FREE for everyone.
 * Privacy model: usage time is measured on the device only (wellbeing-ui.js keeps per-day seconds in localStorage). The server
 * stores the user's wellbeing CHOICES (break reminder, daily limit, hide counts, focus mode, weekly report) and — only after an
 * explicit opt-in (share_totals) — one aggregated row per ISO week (total seconds, sessions, active days). No sessions, no
 * timestamps, no per-day data ever reach the server. Withdrawing the opt-in deletes every stored week.
 * Weekly report: an in-app notification (kind wellbeing_weekly) once per shared week after it ends; email only when SMTP is
 * configured (ctx.mailer.enabled) AND the user turned email_report on AND the address is verified. */
const { E, HttpError } = require("../lib/core");

const BREAKS = [0, 15, 20, 30, 45, 60, 90];
const MAX_LIMIT = 600; // daily limit, minutes
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

/** ISO-8601 week id ("2026-W42") of a date (UTC) */
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
/** Monday (UTC) of an ISO week id, or null */
function weekStart(id) {
  const m = WEEK_RE.exec(id || ""); if (!m) return null;
  const y = +m[1], w = +m[2]; if (w < 1 || w > 53) return null;
  const jan4 = new Date(Date.UTC(y, 0, 4)), d = jan4.getUTCDay() || 7;
  const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - d + 1 + (w - 1) * 7);
  return isoWeek(mon) === id ? mon : null;
}
const DEFAULTS = { breakMinutes: 0, dailyLimitMinutes: 0, hideCounts: false, focus: false, weeklyReport: true, shareTotals: false, emailReport: false };
const out = (r) => (r ? { breakMinutes: r.break_minutes, dailyLimitMinutes: r.daily_limit_minutes, hideCounts: !!r.hide_counts, focus: !!r.focus, weeklyReport: !!r.weekly_report, shareTotals: !!r.share_totals, emailReport: !!r.email_report, updatedAt: new Date(r.updated_at).toISOString() } : { ...DEFAULTS, updatedAt: null });
const weekOut = (r) => ({ week: r.week, seconds: Number(r.seconds), sessions: Number(r.sessions), days: Number(r.days), reported: !!r.reported_at });

/** @param {any} ctx @param {{ now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx;
  const A = ctx.requireUser, R = ctx.router;
  const now = () => (opts.now ? opts.now() : new Date());
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const log = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const mailOn = () => !!ctx.mailer?.enabled;
  const get = (uid) => db.get("SELECT * FROM wellbeing_settings WHERE user_id=$1", [uid]);

  async function save(uid, b) {
    const cur = out(await get(uid)), n = { ...cur };
    const bool = (k) => { if (b[k] === undefined) return; if (typeof b[k] !== "boolean") throw fail(400, "settings_invalid", "إعدادات غير صالحة"); n[k] = b[k]; };
    if (b.breakMinutes !== undefined) { if (!BREAKS.includes(b.breakMinutes)) throw fail(400, "settings_invalid", "مدة التذكير غير صالحة"); n.breakMinutes = b.breakMinutes; }
    if (b.dailyLimitMinutes !== undefined) { const v = b.dailyLimitMinutes; if (!Number.isInteger(v) || v < 0 || v > MAX_LIMIT || (v && v < 10)) throw fail(400, "settings_invalid", "الحد اليومي غير صالح"); n.dailyLimitMinutes = v; }
    ["hideCounts", "focus", "weeklyReport", "shareTotals", "emailReport"].forEach(bool);
    const at = now().toISOString();
    await db.run(`INSERT INTO wellbeing_settings(user_id,break_minutes,daily_limit_minutes,hide_counts,focus,weekly_report,share_totals,email_report,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (user_id) DO UPDATE SET break_minutes=$2, daily_limit_minutes=$3, hide_counts=$4, focus=$5, weekly_report=$6, share_totals=$7, email_report=$8, updated_at=$9`,
      [uid, n.breakMinutes, n.dailyLimitMinutes, n.hideCounts ? 1 : 0, n.focus ? 1 : 0, n.weeklyReport ? 1 : 0, n.shareTotals ? 1 : 0, n.emailReport ? 1 : 0, at]);
    if (cur.shareTotals && !n.shareTotals) await db.run("DELETE FROM wellbeing_weekly WHERE user_id=$1", [uid]); // opt-out = forget
    return out(await get(uid));
  }

  async function putWeek(uid, b) {
    const s = await get(uid);
    if (!s?.share_totals) throw fail(403, "not_opted_in", "مشاركة المجاميع الأسبوعية غير مفعّلة");
    const items = Array.isArray(b?.weeks) ? b.weeks : [b];
    if (!items.length || items.length > 8) throw E.bad();
    const cur = isoWeek(now()), oldest = isoWeek(new Date(now().getTime() - 8 * 7 * 864e5)), saved = [];
    for (const x of items) {
      const ok = x && weekStart(x.week) && x.week <= cur && x.week >= oldest
        && [x.seconds, x.sessions, x.days].every((v) => Number.isInteger(v) && v >= 0)
        && x.seconds <= 7 * 86400 && x.sessions <= 5000 && x.days <= 7 && (x.seconds === 0 || x.days >= 1);
      if (!ok) throw fail(400, "totals_invalid", "مجاميع غير صالحة");
      await db.run(`INSERT INTO wellbeing_weekly(user_id,week,seconds,sessions,days,updated_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT (user_id, week) DO UPDATE SET seconds=$3, sessions=$4, days=$5, updated_at=$6`, [uid, x.week, x.seconds, x.sessions, x.days, now().toISOString()]);
      saved.push(x.week);
    }
    return { ok: true, saved };
  }

  /** weekly report: one in-app notification per shared, finished week (and email if configured + chosen) */
  async function report() {
    const cur = isoWeek(now());
    const rows = await db.all(`SELECT w.user_id, w.week, s.weekly_report, s.email_report FROM wellbeing_weekly w JOIN wellbeing_settings s ON s.user_id=w.user_id
      WHERE w.reported_at IS NULL AND w.week < $1 AND s.share_totals=1 ORDER BY w.week LIMIT 500`, [cur]);
    let notified = 0, emailed = 0;
    for (const r of rows) {
      const claim = await db.run("UPDATE wellbeing_weekly SET reported_at=$1 WHERE user_id=$2 AND week=$3 AND reported_at IS NULL", [now().toISOString(), r.user_id, r.week]);
      if (!claim.changes || !r.weekly_report) continue;
      const n = await ctx.services.notify?.notify?.(r.user_id, "wellbeing_weekly", { ref: r.week }).catch((e) => { log.warn?.("wellbeing notify failed", { err: e.message }); return null; });
      if (n) notified++;
      if (r.email_report && mailOn() && ctx.services.mail?.sendNotification) {
        try { const m = await ctx.services.mail.sendNotification({ user: r.user_id, kind: "wellbeing_weekly", ref: r.week, actor: null }); if (m?.status === "sent") emailed++; } catch (e) { log.warn?.("wellbeing email failed", { err: e.message }); }
      }
    }
    const pruned = (await db.run("DELETE FROM wellbeing_weekly WHERE week < $1", [isoWeek(new Date(now().getTime() - 8 * 7 * 864e5))])).changes || 0; // retention: 8 weeks
    return { checked: rows.length, notified, emailed, pruned };
  }

  R.get("/api/wellbeing/config", async () => ({ free: true, breaks: BREAKS, maxDailyLimit: MAX_LIMIT, email: mailOn(), localOnly: true, week: isoWeek(now()) }));
  R.get("/api/wellbeing/settings", A(async (req) => ({ settings: out(await get(req.user.id)), email: mailOn() })));
  R.put("/api/wellbeing/settings", A(async (req) => ({ settings: await save(req.user.id, req.body || {}), email: mailOn() })));
  R.post("/api/wellbeing/weekly", A(async (req) => putWeek(req.user.id, req.body || {})));
  R.get("/api/wellbeing/weekly", A(async (req) => ({ weeks: (await db.all("SELECT * FROM wellbeing_weekly WHERE user_id=$1 ORDER BY week DESC LIMIT 12", [req.user.id])).map(weekOut) })));
  R.del("/api/wellbeing/weekly", A(async (req) => { const r = await db.run("DELETE FROM wellbeing_weekly WHERE user_id=$1", [req.user.id]); return { ok: true, deleted: r.changes || 0 }; }));

  const env = process.env;
  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.WELLBEING_JOBS !== "0";
  if (jobsOn && ctx.scheduler) ctx.scheduler.every("wellbeing.weekly", +(env.WELLBEING_JOB_INTERVAL_MS || 60 * 60e3), report);
  return { report, save, putWeek, isoWeek, weekStart, settings: async (uid) => out(await get(uid)) };
};
module.exports.isoWeek = isoWeek;
module.exports.weekStart = weekStart;
