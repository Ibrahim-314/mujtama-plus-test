/* مجتمع بلس — API server v2.2.0
 * Logically separated services communicating through an internal event bus (spec §105–§107).
 * Run:  node server.js   (SQLite dev DB)   |   DATABASE_URL=postgres://... node server.js */
const http = require("node:http"), path = require("node:path");
const { HttpError, E, now } = require("./lib/core");
const Scale = require("./lib/scale"); // Phase 48: opt-in Redis/NATS adapters + ROLE split (defaults = in-process)
const { Router, parseCookies, readBody, serveStatic, SEC_HEADERS, Realtime, cookieHeader } = require("./lib/http");
const { connect } = require("./lib/db");
const { migrate } = require("./lib/schema");
const { log, requestId } = require("./lib/log");
const { secret } = require("./lib/secrets");
const { sha } = require("./lib/core");

const config = {
  version: require("./package.json").version, // single source of truth: server/package.json (kept equal to the root package.json)
  port: +(process.env.PORT || 8080),
  host: process.env.HOST || "0.0.0.0",
  webRoot: process.env.WEB_ROOT || path.join(__dirname, ".."),
  storageDir: process.env.STORAGE_DIR || path.join(__dirname, "storage"),
  storageDriver: process.env.STORAGE_DRIVER || "local",
  secureCookies: process.env.NODE_ENV === "production",
  seedDemo: process.env.SEED_DEMO !== "0",
  /* v2.82.1: «دخول تجريبي» button — test copies only (Render). Needs DEMO_LOGIN=1 AND refuses to turn on under Railway
   * (production), whatever the env says, so it can never leak into the live app. */
  demoLogin: process.env.DEMO_LOGIN === "1" && !process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_PROJECT_ID,
  piEnabled: process.env.PI_ENABLED === "1",
  piApiKey: secret("PI_API_KEY"),
  piApi: process.env.PI_API_URL || "https://api.minepi.com",
  translateUrl: process.env.TRANSLATE_URL || null,
  translateKey: secret("TRANSLATE_KEY"),
  rpId: process.env.WEBAUTHN_RP_ID || null,
  origins: process.env.WEBAUTHN_ORIGINS ? process.env.WEBAUTHN_ORIGINS.split(",").map(s => s.trim()) : null,
  logRequests: process.env.LOG_REQUESTS === "1" || process.env.NODE_ENV === "production",
  fakeVideoMs: +(process.env.FAKE_VIDEO_MS || 3500),
  trustProxy: proxyHops(process.env.TRUST_PROXY)
};
/* TRUST_PROXY (v2.51): set when a trusted reverse proxy sits in front of the app (Railway's edge). Railway's edge OVERWRITES
 * X-Real-IP and X-Forwarded-For on every request (caller copies are replaced, not appended), and recommends X-Real-IP as the
 * client address; X-Forwarded-For may carry an extra Railway hop on the right, so its LEFTMOST entry is the client.
 * Order: X-Real-IP → leftmost X-Forwarded-For → socket. Unset/0 = socket address only (headers ignored). "1"/"true" = on. */
function proxyHops(v) { const s = String(v || "").trim().toLowerCase(); return s === "true" || s === "yes" || (parseInt(s, 10) > 0) ? 1 : 0; }
function clientIp(req, trusted) {
  if (!trusted) return req.socket.remoteAddress;
  const real = String(req.headers["x-real-ip"] || "").split(",")[0].trim();
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return real || xff || req.socket.remoteAddress;
}

async function createApp(overrides = {}) {
  Object.assign(config, overrides);
  const db = await connect(overrides.databaseUrl || secret("DATABASE_URL") || undefined);
  await migrate(db, { log: (m) => log.info(m) });
  const { bus, cache, rl, scale } = await Scale.createScale({ log, overrides }), realtime = new Realtime(), router = new Router();
  const STREAM = Symbol("stream");
  const ctx = { db, bus, cache, rl, realtime, router, config, services: {}, STREAM, scale };
  ctx.policy = require("./lib/policy").createPolicy(db);
  ctx.storage = require("./lib/storage").createStorage(config.storageDir, { db, log, driver: config.storageDriver }); // STORAGE_DRIVER=db keeps media in the database
  ctx.queue = require("./lib/queue").createQueue(db, { log });
  ctx.analytics = require("./lib/analytics").createAnalytics({ log });
  ctx.scheduler = require("./lib/scheduler").createScheduler(db, { log });
  Scale.applyRole(ctx); Scale.applySessions(ctx);                        // Phase 48: ROLE job split + optional Redis session cache
  ctx.llm = require("./lib/llm").createLLM(db, { log, secret });          // swappable LLM providers + cost limits (Phase 25)
  ctx.mailer = require("./lib/providers").switchableMailer(require("./lib/mailer").createMailer(secret("SMTP_URL"))); // SMTP_URL, or admin-saved SMTP (phase 52, services/activation.js swaps it in)
  /* Tamper-evident audit log (Phase 4): each entry hashes the previous one, so any edit or deletion
   * breaks the chain and is detected by verifyAudit(). Writes are serialized to keep the chain linear. */
  let auditChain = Promise.resolve();
  const auditHash = (prev, e) => sha([prev || "", e.action, e.target || "", e.reason || "", e.by || "", e.at].join("|"));
  ctx.audit = (action, target, reason, by) => (auditChain = auditChain.then(async () => {
    const last = await db.get("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1");
    const e = { action, target: target || null, reason: reason || null, by: by || null, at: now() };
    await db.run("INSERT INTO audit_log(action,target,reason,by_user,at,prev_hash,hash) VALUES($1,$2,$3,$4,$5,$6,$7)", [e.action, e.target, e.reason, e.by, e.at, last?.hash || null, auditHash(last?.hash, e)]);
  }).catch(err => log.error("audit write failed", { err })));
  ctx.verifyAudit = async () => {
    const rows = await db.all("SELECT * FROM audit_log ORDER BY id"); let prev = null, checked = 0;
    for (const r of rows) { if (!r.hash) continue; if (r.prev_hash !== prev || r.hash !== auditHash(prev, { action: r.action, target: r.target, reason: r.reason, by: r.by_user, at: r.at })) return { ok: false, brokenAt: r.id, checked }; prev = r.hash; checked++; }
    return { ok: true, checked };
  };
  ctx.cperm = require("./lib/cperm")(db, E); // v2.56: one community permission engine (hierarchy + custom roles)
  ctx.requireUser = (fn) => async (req, res) => { if (!req.user) throw E.auth(); return fn(req, res); };
  ctx.track = () => { };
  // service registry (each owns its routes & subscriptions)
  ctx.services.platform = require("./services/platform")(ctx);
  ctx.services.users = require("./services/users")(ctx);
  ctx.services.security = require("./services/security")(ctx);
  ctx.services.ops = require("./services/ops")(ctx);
  ctx.services.identity = require("./services/identity")(ctx);
  ctx.services.orgs = require("./services/orgs")(ctx);
  ctx.services.reputation = require("./services/reputation")(ctx);
  ctx.services.growth = require("./services/growth")(ctx);
  ctx.services.creation = require("./services/creation")(ctx);
  ctx.services.rooms = require("./services/rooms")(ctx);
  ctx.services.studio = require("./services/studio")(ctx);
  ctx.services.cspace = require("./services/cspace")(ctx);
  ctx.services.cchannels = require("./services/cchannels")(ctx);    // v2.58: channel groups/archive/slow mode/role channels, pins, announcements, structured rules, welcome steps
  ctx.services.cmod = require("./services/cmod")(ctx);
  ctx.services.knowledge = require("./services/knowledge")(ctx);
  ctx.services.eventsPlus = require("./services/events-plus")(ctx);
  ctx.services.content = require("./services/content")(ctx);
  ctx.services.communities = require("./services/communities")(ctx);
  ctx.services.cadmin = require("./services/cadmin")(ctx);          // v2.57: community admin panel API (overview, requests history, member invites, transfer, archive, lockdown, export)
  ctx.services.cmod2 = require("./services/cmod2")(ctx);            // v2.59: moderation v2 (claims, bulk, macros, appeals, moderator prefs) + automod v2 (rules, tester, stats, ladder)
  ctx.services.discovery = require("./services/discovery")(ctx);
  ctx.services.ranking = require("./services/ranking")(ctx);
  ctx.services.search = require("./services/search")(ctx);
  ctx.services.trends = require("./services/trends")(ctx);
  ctx.services.clips = require("./services/clips")(ctx);         // v2.70: خلاصة اللقطات — ranked/following video feed + watch progress (clip_watch, 070)
  ctx.services.challenges = require("./services/challenges")(ctx); // v2.78: «تحدي الأسبوع» — weekly Vidtik hashtag challenges (clip_challenges, 077)
  ctx.services.clipstudio = require("./services/clipstudio")(ctx); // v2.80: «أدوات صانع فيديوتك» — drafts, per-clip stats, best time (clip_drafts, 078)
  ctx.services.collections = require("./services/collections")(ctx);
  ctx.services.summaries = require("./services/summaries")(ctx);
  ctx.services.messaging = require("./services/messaging")(ctx);
  ctx.ws = require("./lib/ws").createHub(ctx);                     // WebSocket hub (Phase 26): ctx.ws.send/on; SSE stays the fallback
  ctx.services.chat = require("./services/chat")(ctx);
  ctx.services.e2ee = require("./services/e2ee")(ctx);
  ctx.services.notify = require("./services/notify")(ctx);       // Phase 28: channels, push, quiet hours, grouping, ranking
  ctx.services.mail = require("./services/mail")(ctx);           // Phase 29: transactional mail, unsubscribe, bounces, DKIM
  ctx.services.safety = require("./services/safety")(ctx);
  ctx.services.automod = require("./services/automod")(ctx);       // Phase 31
  ctx.services.integrity = require("./services/integrity")(ctx);   // Phase 32
  ctx.services.protection = require("./services/protection")(ctx); // Phase 33
  ctx.services.compliance = require("./services/compliance")(ctx); // Phase 34
  ctx.services.media = require("./services/media")(ctx);
  ctx.services.calls = require("./services/calls")(ctx);
  ctx.services.pi = require("./services/pi")(ctx, config.piOpts);        // Phase 36: Pi sign-in/linking, payments, wallet, receipts, reconciliation
  ctx.services.tips = require("./services/tips")(ctx, config.tipsOpts);    // Phase 37: tips, monthly support, double-entry ledger, earnings
  ctx.services.paid = require("./services/paid")(ctx, config.paidOpts);    // Phase 38: supporter-only + pay-per-view posts, locked-content filtering, refunds
  ctx.services.market = require("./services/market")(ctx, config.marketOpts); // Phase 39: community marketplace (listings, orders, escrow, reviews, disputes)
  ctx.services.ads = require("./services/ads")(ctx, config.adsOpts);         // Phase 40: ethical ads (promoted posts, privacy-safe targeting, review, CPM budget)
  ctx.services.ai = require("./services/ai")(ctx, config.aiOpts);             // Phase 41: AI plans + monthly Pi subscriptions + entitlements + metering
  ctx.services.translate = require("./services/translate")(ctx, config.translateOpts); // Phase 41: real machine translation (subscribers), shared cache
  ctx.services.i18n = require("./services/i18n")(ctx, config.i18nOpts);       // Phase 41: interface languages ar/en + UI string management (free)
  ctx.services.aihub = require("./services/aihub")(ctx, config.aihubOpts);       // v2.77: «مركز الذكاء» — members link their own AI accounts (OpenRouter one tap, Gemini/Groq/… keys)
  ctx.services.assistant = require("./services/assistant")(ctx, config.assistantOpts); // Phase 42: AI assistant (writing, replies, cited Q&A, semantic search)
  ctx.services.a11y = require("./services/a11y")(ctx, config.a11yOpts);       // Phase 43: display settings (a11y.*), alt text, WebVTT captions, periodic audit (free)
  ctx.services.prefs = require("./services/prefs")(ctx, config.prefsOpts);    // Phase 44: server-stored preferences (themes, density, nav, icons) + cross-device sync (free)
  ctx.services.wellbeing = require("./services/wellbeing")(ctx, config.wellbeingOpts); // Phase 45: digital wellbeing (free; usage measured on device, opt-in weekly totals)
  ctx.services.pwa = require("./services/pwa")(ctx);                         // Phase 46: installable app config (push availability, release)
  ctx.services.devapi = require("./services/devapi")(ctx, config.devapiOpts);   // Phase 47: developer API v1, OAuth+PKCE, webhooks, bots
  ctx.services.observability = require("./services/observability")(ctx, config.opsOpts);
  ctx.services.backup = require("./services/backup")(ctx); // v2.68: GET /api/ops/backup (only with BACKUP_TOKEN + BACKUP_PASSPHRASE on PostgreSQL) // Phase 49: /metrics, tracing, alerts, SLOs, /status
  ctx.services.launch = require("./services/launch")(ctx, config.launchOpts);   // Phase 50: help center, support tickets, ambassadors, waitlist + invite rollout
  ctx.services.piActivation = require("./services/piactivation")(ctx, config.piActivationOpts); // Phase 51: Pi payments activation checklist, dry run, recovery
  ctx.services.transfers = require("./services/transfers")(ctx, config.transfersOpts);          // Phase 56: Pi transfers between users + payment requests
  ctx.services.activation = require("./services/activation")(ctx, config.activationOpts);       // Phase 52: push / email / translation activation + unified checklist
  ctx.services.creatorSubs = require("./services/creatorsubs")(ctx, config.creatorSubsOpts);    // Phase 57: creator subscription tiers, benefits, renewals, proration, churn
  ctx.services.digital = require("./services/digital")(ctx, config.digitalOpts);                // Phase 58: digital products store (extends the market)
  ctx.services.beta = require("./services/beta")(ctx, config.betaOpts);                         // Phase 54: invite-based beta waves, feedback triage, surveys, cohort dashboard, flag kill switch
  ctx.services.points = require("./services/points")(ctx, config.pointsOpts);                   // Phase 59: contribution points, levels, leaderboard, campaigns, Pi rewards pool
  ctx.services.mjt = require("./services/mjt")(ctx, config.mjtOpts);                            // v2.47 MJT «مجتمع كوين» stage 1: in-app double-entry ledger (not on any chain), points → MJT conversion, rewards, transfers
  ctx.services.mining = require("./services/mining")(ctx, config.miningOpts);                   // v2.87 «التعدين»: 24-hour MJT mining sessions + daily sign-in reward (migration 079)
  ctx.services.finance = require("./services/finance")(ctx, config.financeOpts);                 // Phase 60: statements, sequential invoices, annual summaries, public finance transparency, reconciliation
  ctx.services.canalytics = require("./services/canalytics")(ctx, config.canalyticsOpts);       // Phase 61: advanced creator analytics (audience, content, earnings, compare, CSV) — extends the studio
  ctx.services.nearby = require("./services/nearby")(ctx, config.nearbyOpts);                   // Phase 66: nearby events + moderated places on a map, coarse opt-in location, city pages
  ctx.services.study = require("./services/study")(ctx, config.studyOpts);                      // Phase 71: study groups + halaqat on communities (sessions, attendance, notes, goals, progress, reminders)
  ctx.services.series = require("./services/series")(ctx, config.seriesOpts);                   // Phase 62: scheduled publishing queue (idempotent publisher) + content series, follow, new-episode notifications
  ctx.services.business = require("./services/business")(ctx, config.businessOpts);             // Phase 67: local business directory on P66 places (claims, accepts-Pi, contact, search)
  ctx.services.courses = require("./services/courses")(ctx, config.coursesOpts);                // Phase 72: courses → modules → lessons on P71 study groups (enrol, progress, quizzes, completion hook for P73)
  ctx.services.collabs = require("./services/collabs")(ctx, config.collabsOpts);                // Phase 63: creator ↔ brand collaborations, sponsorships, locked paid-partnership disclosure
  ctx.services.hijri = require("./services/hijri")(ctx, config.hijriOpts);                      // Phase 68: Hijri calendar (Umm al-Qura + sighting overrides), seasons, reminders, /hijri.ics
  ctx.services.certs = require("./services/certs")(ctx, config.certsOpts);                      // Phase 73: signed, verifiable certificates (course / study / exam), /cert/<code>
  ctx.services.exams = require("./services/exams")(ctx, config.examsOpts);                      // Phase 73: formal quizzes (timed, shuffled, server-scored) → certificates
  ctx.services.mentors = require("./services/mentors")(ctx, config.mentorsOpts);                // Phase 74: mentorship (expert profiles, requests/matching, booking + iCal, notes, ratings, optional Pi escrow)
  ctx.services.vcreators = require("./services/vcreators")(ctx, config.vcreatorsOpts);          // Phase 65: verified creators program + creator support fund (ledger; money off while Pi is off)
  ctx.services.charity = require("./services/charity")(ctx, config.charityOpts);                // Phase 70: volunteering, verified charities, transparent campaigns (ledger; donations off while Pi is off)
  ctx.services.openlib = require("./services/openlib")(ctx, config.openlibOpts);                // Phase 75: open knowledge library (CC licences, reviewed revisions, history + diff, search, reports)
  ctx.services.proprofile = require("./services/proprofile")(ctx, config.proprofileOpts);          // Phase 76: professional profile & CV (sections + privacy, printable /cv/<handle>, JSON Resume, talent directory, reports)
  ctx.services.jobs = require("./services/jobs")(ctx, config.jobsOpts);                            // Phase 77: jobs & freelance board (apply with the professional profile, employer pipeline, anti-scam review, Pi featured boost — off while Pi is off)
  ctx.services.contracts = require("./services/contracts")(ctx, config.contractsOpts);              // Phase 78: contracts, milestones, escrow via the ledger (funding off while Pi is off), disputes with staff resolution
  ctx.services.teams = require("./services/teams")(ctx, config.teamsOpts);                         // Phase 79: teams & group projects (roles, invites/links/requests, task board, files & links, updates, contract link)
  ctx.services.proreviews = require("./services/proreviews")(ctx, config.proreviewsOpts);           // Phase 80: verified professional reviews (completed contracts / teams only, double-blind), endorsements, badges, moderation
  ctx.services.pricing = require("./services/pricing")(ctx, config.pricingOpts);                // Phase 53: price book, grandfathering, revenue/cost dashboard (after every priced service)
  ctx.services.cinsights = require("./services/cinsights")(ctx);                                // v2.60: community insights (live counters + nightly reconciler), events section, community calendar, member notifications per community
  ctx.services.cintegrations = require("./services/cintegrations")(ctx, config.cintegrationsOpts || {}); // v2.60: community webhooks (signed like phase 47), partner search, integrations view, MJT rewards paid by the owner through the MJT ledger
  await Scale.wireScale(ctx);                                               // Phase 48: realtime fan-out via Redis + /api/admin/scale
  ctx.services.minors = require("./services/minors")(ctx, config.minorsOpts);     // Phase 35 (must stay last: wraps content/search routes)
  if (config.seedDemo && !Scale.isWorker(scale.role)) await require("./services/seed")(ctx, process.env.SEED_ROOT || config.webRoot);
  ctx.services.demoMessages = require("./services/demo-messages")(ctx);              // v2.134: demo DMs/groups for messages-AI testing (DEMO_MESSAGES=1 on Render test only; removed when off)
  if (!Scale.isWorker(scale.role)) await ctx.services.demoMessages.boot();

  // v2.68: top-level safety net — nothing thrown while handling a request may take the process down
  function handle(req, res) {
    return handleInner(req, res).catch(e => {
      try { log.error("request crashed", { method: req.method, err: e }); } catch { }
      try { if (!res.headersSent) { res.writeHead(500, { ...SEC_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: "حدث خطأ غير متوقع", code: "server_error" })); } else res.end(); } catch { }
    });
  }
  async function handleInner(req, res) {
    const started = Date.now();
    // v2.51: HEAD is answered exactly like GET (same status + headers); Node drops the body for HEAD responses itself
    if (req.method === "HEAD") { req.isHead = true; req.method = "GET"; }
    let url; try { url = new URL(req.url, "http://x"); } catch { res.writeHead(400, { ...SEC_HEADERS, "Content-Type": "application/json; charset=utf-8" }); return res.end(JSON.stringify({ error: "طلب غير صالح", code: "bad_request" })); }
    req.id = requestId(req.headers["x-request-id"]); res.setHeader("X-Request-Id", req.id);
    req.ip = clientIp(req, config.trustProxy);
    req.query = Object.fromEntries(url.searchParams);
    req.cookies = parseCookies(req.headers.cookie);
    const cookies = [];
    res.cookie = (k, v, { maxAge }) => cookies.push(cookieHeader(k, v, maxAge, !!config.secureCookies));
    const send = (status, body) => {
      if (res.headersSent) return;
      res.writeHead(status, { ...SEC_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(cookies.length ? { "Set-Cookie": cookies } : {}) });
      res.end(JSON.stringify(body));
    };
    try {
      if (!Scale.allowsHttp(scale.role, url.pathname)) return send(404, { error: "غير موجود", code: "worker_role" });
      if (url.pathname.startsWith("/media/")) {
        const name = url.pathname.slice(7), gate = ctx.services.paid ? await ctx.services.paid.mediaGate(req, name) : "public"; // phase 38: paid media needs an entitled viewer
        if (gate === "deny") return send(403, { error: "هذا المحتوى مدفوع", code: "paid_locked" });
        const cgate = await ctx.services.media.communityGate(req, name); // v2.60 M5: private-community media → members only, 404 otherwise
        if (cgate === "deny") return send(404, { error: "غير موجود" });
        if (await ctx.services.media.serve(req, res, name, { private: gate === "private" || cgate === "private" })) return; return send(404, { error: "غير موجود" });
      }
      if (req.method === "GET" && (await ctx.services.creation.ssr(req, res, url) || await ctx.services.cspace.ssr(req, res, url) || await ctx.services.eventsPlus.ics(req, res, url) || await ctx.services.cinsights.ics(req, res, url) || await ctx.services.compliance.ssr(req, res, url) || await ctx.services.devapi.ssr(req, res, url) || await ctx.services.observability.ssr(req, res, url) || await ctx.services.piActivation.ssr(req, res, url) || await ctx.services.finance.ssr(req, res, url) || await ctx.services.hijri.ssr(req, res, url) || await ctx.services.certs.ssr(req, res, url) || await ctx.services.mentors.ssr(req, res, url) || await ctx.services.proprofile.ssr(req, res, url))) return;
      if (!url.pathname.startsWith("/api/")) {
        if (req.method === "GET" && serveStatic(config.webRoot, req, res, url.pathname)) return;
        if (req.method === "GET" && serveStatic(config.webRoot, req, res, "/index.html")) return;
        return send(404, { error: "غير موجود" });
      }
      const route = router.match(req.method, url.pathname);
      if (!route) throw E.nf("المسار غير موجود"); // v2.68: malformed %-escapes now resolve to 404 instead of 500
      // CSRF defence: state-changing requests must be same-origin JSON (or raw upload) with our header
      // (beacon telemetry routes are append-only and exempt: sendBeacon cannot set headers)
      // (Pi sign-in, route opt piLogin: authenticated by the Pi accessToken itself, so the header is not required there;
      //  the handler still requires it for anything that acts on an existing session, e.g. link:true)
      req.csrfOk = req.headers["x-requested-with"] === "mujtama";
      if (req.method !== "GET" && !route.opts.beacon && !route.opts.piLogin && !route.opts.apiToken && !req.csrfOk) throw E.forbid("طلب مرفوض");
      if (route.opts.raw) req.rawBody = await readBody(req, route.opts.rawLimit || 210 * 1024 * 1024); // v2.60 M3: chunk routes cap the body early
      else if (req.method !== "GET") { const b = await readBody(req, 1024 * 1024); try { req.body = b.length ? JSON.parse(b) : {}; } catch { throw E.bad("JSON غير صالح"); } if (typeof req.body !== "object" || req.body === null) throw E.bad(); }
      else req.body = {};
      req.params = route.params;
      req.user = await ctx.services.users.resolve(req);
      await ctx.services.orgs.applyActAs(req);
      const out = await route.handler(req, res);
      ctx.services.orgs.afterAction(req).catch(() => { });
      if (out === STREAM) return;
      send(200, out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof URIError ? 400 : 500; // v2.68: malformed %-escapes are a bad request, not a server error
      if (status === 500) log.error("unhandled", { rid: req.id, method: req.method, path: url.pathname, err: e });
      send(status, { error: status === 500 ? "حدث خطأ غير متوقع" : e instanceof URIError ? "طلب غير صالح" : e.message, code: e.code || "server_error", requestId: req.id, ...(status < 500 && e.details ? e.details : {}) });
    } finally {
      if (config.logRequests) log.info("request", { rid: req.id, method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started, user: req.user?.id });
    }
  }

  // background jobs (cron-like); move to a worker process/queue at scale
  ctx.jobsState = {};
  const job = (name, ms, fn) => setInterval(async () => {
    const t = Date.now();
    try { await fn(); ctx.jobsState[name] = { ok: true, lastRun: new Date().toISOString(), ms: Date.now() - t }; }
    catch (e) { ctx.jobsState[name] = { ok: false, lastRun: new Date().toISOString(), error: e.message }; log.error("job failed", { job: name, err: e }); }
  }, ms);
  const jobs = Scale.isWorker(scale.role) ? [] : [
    job("publishDue", 15e3, () => ctx.services.content.publishDue()),
    // event reminders, recurrence and status now run as a leased scheduled job (services/events-plus.js)
    // location trends are a leased 5-minute scheduled job in services/trends.js (Phase 23)
    job("reputation", 30 * 60e3, () => ctx.services.reputation.reputationJob()),
    job("sessionCleanup", 3600e3, () => db.run("DELETE FROM sessions WHERE expires_at < $1", [now()]))
  ];
  if (!overrides.worker && process.env.MEDIA_WORKER !== "external") ctx.queue.start(overrides.queuePollMs || 1000);
  const server = http.createServer(handle);
  ctx.services.observability.attach(server); // Phase 49: request metrics + trace context (first 'request' listener)
  server.on("upgrade", (req, socket, head) => (Scale.isWorker(scale.role) ? socket.destroy() : ctx.ws.upgrade(req, socket, head)));
  server.keepAliveTimeout = 65e3;
  const close = async () => { jobs.forEach(clearInterval); ctx.ws.closeAll(); ctx.queue.stop(); ctx.scheduler.stop(); await new Promise(r => server.close(r)); await Scale.closeScale(scale); await db.close(); };
  return { server, ctx, close };
}

if (require.main === module) {
  // v2.68: process-level safety nets — log and keep serving instead of dying on a stray rejection
  process.on("unhandledRejection", e => { try { log.error("unhandledRejection", { err: e }); } catch { } });
  process.on("uncaughtException", e => { try { log.error("uncaughtException", { err: e }); } catch { } });
  createApp().then(({ server, close }) => {
    server.listen(config.port, config.host, () => log.info(`مجتمع بلس v${config.version} listening`, { port: config.port }));
    // v2.68: graceful shutdown with a hard deadline (open SSE/keep-alive sockets no longer block exit)
    let stopping = false;
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
      if (stopping) return; stopping = true;
      log.info("shutdown", { sig });
      setTimeout(() => { try { server.closeIdleConnections?.(); } catch { } }, 0).unref();
      setTimeout(() => { try { server.closeAllConnections?.(); } catch { } }, 8000).unref();
      setTimeout(() => process.exit(0), 15000).unref();
      close().then(() => process.exit(0), e => { log.error("shutdown failed", { err: e }); process.exit(1); });
    });
  }).catch(e => { log.error("startup failed", { err: e }); process.exit(1); });
}
module.exports = { createApp, config };
