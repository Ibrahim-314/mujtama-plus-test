/* =====================================================================
 * مجتمع بلس — v2.7 notifications UI (Track 6, phase 28), loaded as the lazy "notify" chunk.
 * • Notification center: tabs (الكل/الإشارات/المتابعات/التفاعلات/المجتمعات) with unread counts, grouped
 *   rows («أحمد و5 آخرون أعجبهم منشورك»), importance ordering («الأهم») or time sections («الأحدث»),
 *   mark one group / a tab / everything as read.
 * • In-app toasts for realtime notifications: slide in gently from the top, pause on hover/focus, swipe or
 *   Esc to dismiss, polite aria-live region, fade-only under prefers-reduced-motion.
 * • Notification settings (#/notifsettings): per-kind switches for in-app / push / email, quiet hours with
 *   timezone, urgent bypass, enable-push flow with a pre-prompt, test push.
 * • Email preferences (#/emailprefs): digest frequency, transactional alerts, unsubscribe-all with undo;
 *   also the landing of the one-click unsubscribe link (#/unsubscribe?t=…, #/emailprefs?unsubscribed=…).
 * Logic lives in notify-core.js (window.MPNotify) when present; every call falls back to the documented
 * REST routes (docs/COMMUNICATION.md §28) and, offline, to the local store. Styles are injected here so
 * the core CSS stays inside its budget.
 * ===================================================================== */
(function NotifyUI() {
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const h = (s) => esc(String(s ?? ""));
  const N = () => window.MPNotify || {};
  const has = (f) => typeof N()[f] === "function";
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const say = (msg) => { const r = document.getElementById("nf-say"); if (r) { r.textContent = ""; setTimeout(() => (r.textContent = msg), 40); } };

  /* ---------- icons used here (added to the shared sprite once) ---------- */
  const ICONS = {
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
    bellOff: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"/><path d="m2 2 20 20"/><path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05"/>',
    moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
    phoneMissed: '<path d="m16 2 6 6"/><path d="m22 2-6 6"/><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
    calendar: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    checks: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    device: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'
  };
  (function sprite() { const s = document.querySelector("svg[aria-hidden] symbol")?.parentNode; if (!s) return; s.insertAdjacentHTML("beforeend", Object.entries(ICONS).filter(([k]) => !document.getElementById("i-" + k)).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("")); })();

  /* ---------- kinds (mirrors server/lib/notify-lib.js; used offline and for badges/icons) ---------- */
  const TABS = [["all", "الكل"], ["mentions", "الإشارات"], ["follows", "المتابعات"], ["interactions", "التفاعلات"], ["communities", "المجتمعات"]];
  const K = {
    mention: ["mentions", 75, "at", "info", ["أشار إليك", "أشارا إليك", "أشاروا إليك"]],
    reply: ["mentions", 70, "comment", "info", ["ردّ على تعليقك", "ردّا على تعليقك", "ردّوا على تعليقك"], 1],
    follow: ["follows", 45, "userPlus", "accent", ["بدأ بمتابعتك", "بدآ بمتابعتك", "بدؤوا بمتابعتك"], 1],
    follow_request: ["follows", 65, "userPlus", "accent", ["طلب متابعتك", "طلبا متابعتك", "طلبوا متابعتك"], 1],
    follow_approved: ["follows", 50, "userPlus", "accent", ["قبل طلب متابعتك"]],
    reaction: ["interactions", 30, "heartF", "like", ["أعجبه منشورك", "أعجبهما منشورك", "أعجبهم منشورك"], 1],
    comment: ["interactions", 60, "comment", "info", ["علّق على منشورك", "علّقا على منشورك", "علّقوا على منشورك"], 1],
    join_request: ["communities", 55, "community", "ok", ["طلب الانضمام إلى مجتمعك", "طلبا الانضمام إلى مجتمعك", "طلبوا الانضمام إلى مجتمعك"], 1],
    approved: ["communities", 55, "community", "ok", ["قبل طلب انضمامك"]],
    post_approved: ["communities", 50, "check", "ok", ["وافق على منشورك في المجتمع"]],
    invite: ["communities", 60, "send", "ok", ["دعاك للانضمام", "دعواك للانضمام", "دعوك للانضمام"]],
    community_transfer: ["communities", 75, "community", "accent", ["طلب نقل ملكية مجتمع إليك"]],
    event: ["communities", 60, "calendar", "warn", ["تذكير: حدث يبدأ قريباً"]],
    autoguard_strike: ["communities", 80, "shield", "warn", ["وصلك تحذير من الحارس التلقائي في المجتمع"], 0, 1],
    autoguard_lock: ["communities", 85, "shield", "danger", ["أُوقفت عن الكتابة في المجتمع حتى يرفع مشرف الإيقاف"], 0, 1],
    message_request: ["messages", 60, "mail", "accent", ["يريد مراسلتك"]],
    call_missed: ["messages", 70, "phoneMissed", "danger", ["فاتتك مكالمة منه", "فاتتك مكالمات منهما", "فاتتك مكالمات منهم"], 1],
    video: ["system", 40, "play", "accent", ["اكتملت معالجة الفيديو الخاص بك ✓"], 0, 1],
    scheduled: ["system", 40, "clock", "accent", ["نُشر منشورك المجدول ✓"], 0, 1],
    removed: ["system", 70, "shield", "danger", ["أُزيل محتوى لك لمخالفته الإرشادات"], 0, 1],
    welcome: ["system", 20, "sparkle", "accent", ["يرحّب بك مجتمع بلس"], 0, 1]
  };
  const kind = (k) => { const x = K[k] || (String(k).startsWith("security") ? ["system", 95, "shield", "danger", ["تنبيه أمان على حسابك"], 0, 1] : ["system", 30, "bell", "accent", ["لديك إشعار جديد"], 0, 1]); return { tab: x[0], imp: x[1], icon: x[2], tone: x[3], v: x[4], group: !!x[5], system: !!x[6] }; };
  const actorsText = (names, total) => { const n = Math.max(total || 0, names.length), a = names[0] || "مجتمع بلس"; if (n <= 1) return a; if (n === 2) return `${a} و${names[1] || "شخص آخر"}`; const k = n - 1; return k === 2 ? `${a} وشخصان آخران` : k <= 10 ? `${a} و${k} آخرون` : `${a} و${k} شخصاً آخر`; };
  const verb = (k, n) => { const v = kind(k).v; return n <= 1 ? v[0] : n === 2 ? v[1] || v[v.length - 1] : v[2] || v[v.length - 1]; };

  /** offline / legacy-route grouping: same kind + same target within 48 h and same read state */
  function groupLocal(list) {
    const out = [], open = new Map();
    for (const n of [...list].sort((a, b) => new Date(b.at) - new Date(a.at))) {
      const k = kind(n.kind), key = k.group ? `${n.kind}:${n.post || n.ref || "me"}:${n.read ? 1 : 0}` : n.id;
      const g = open.get(key);
      if (g && new Date(g.at) - new Date(n.at) < 48 * 3600e3) { g.ids.push(n.id); if (n.actor && !g.actorIds.includes(n.actor)) g.actorIds.push(n.actor); g.count = Math.max(g.actorIds.length, 1); continue; }
      const ng = { key, kind: n.kind, ids: [n.id], actorIds: n.actor ? [n.actor] : [], count: 1, at: n.at, read: !!n.read, post: n.post, ref: n.ref, importance: n.importance ?? k.imp };
      open.set(key, ng); out.push(ng);
    }
    return out.map(g => {
      const actors = g.actorIds.slice(0, 3).map(id => S.user(id)).filter(Boolean), names = actors.map(a => a.name);
      const age = (Date.now() - new Date(g.at)) / 3600e3;
      return { ...g, actors, tab: kind(g.kind).tab, text: kind(g.kind).system && !names.length ? verb(g.kind, 1) : `${actorsText(names, g.count)} ${verb(g.kind, g.count)}`, names: actorsText(names, g.count),
        href: g.post ? "#/post/" + g.post : g.kind === "community_transfer" && g.ref ? "#/cadmin/" + g.ref : g.ref && S.community?.(g.ref) ? "#/c/" + g.ref : actors[0] ? "#/u/" + actors[0].handle : "#/notifications",
        score: g.importance + (g.read ? 0 : 15) + Math.min(g.count, 10) * 2 - Math.min(age, 72) / 2, important: g.importance >= 70 && !g.read };
    });
  }

  /* ---------- data access: MPNotify → REST → local ---------- */
  async function loadCenter(tab, sort) {
    if (online()) {
      try {
        const d = has("center") ? await N().center({ tab, sort }) : await api("GET", `/api/notifications?view=center&tab=${tab}&sort=${sort}`);
        if (d && Array.isArray(d.groups)) return d;
      } catch (e) { if (e.status === 401) throw e; }
    }
    const mine = (DB.notifications || []).filter(n => !n.user || n.user === DB.me);
    let groups = groupLocal(mine);
    const tabs = TABS.map(([key, label]) => ({ key, label, unread: groups.filter(g => !g.read && (key === "all" || g.tab === key)).reduce((a, g) => a + g.ids.length, 0) }));
    if (tab !== "all") groups = groups.filter(g => g.tab === tab);
    if (sort !== "new") groups.sort((a, b) => b.score - a.score);
    return { tab, sort, tabs, groups, unread: tabs[0].unread, local: true };
  }
  function syncLocalRead(ids) {
    const set = ids ? new Set(ids) : null;
    (DB.notifications || []).forEach(n => { if (!set || set.has(n.id)) n.read = true; });
    // keep the sync layer from diffing this into a blanket "mark everything read"
    if (online() && Remote.snap) Remote.snap.unread = DB.notifications.filter(n => !n.read).length; else if (!online()) save();
    App.refreshBadges();
  }
  async function markRead(body) {
    if (online()) {
      if (has("markRead")) await N().markRead(body); else await api("POST", "/api/notifications/read", body);
    }
    syncLocalRead(body.ids || (body.tab && body.tab !== "all" ? (DB.notifications || []).filter(n => kind(n.kind).tab === body.tab).map(n => n.id) : null));
  }

  /* ---------- styles ---------- */
  const CSS = `
.nf-head{display:flex;align-items:center;gap:8px;margin:4px 0 10px}.nf-head h2{margin:0;flex:1;font-size:var(--fs-2xl)}
.nf-ib{width:44px;height:44px;border-radius:14px;display:inline-grid;place-items:center;background:var(--card);box-shadow:var(--sh-1);color:var(--text-2);border:0;cursor:pointer;flex:none}
.nf-ib:hover{color:var(--accent)}.nf-ib .ic{width:21px;height:21px}
.nf-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px 10px;padding:2px 16px 4px;scroll-snap-type:x proximity}.nf-tabs::-webkit-scrollbar{display:none}
.nf-tab{flex:none;scroll-snap-align:start;border:0;min-height:40px;padding:0 14px;border-radius:999px;background:var(--bg-2);color:var(--text-2);font:inherit;font-weight:650;font-size:14px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;transition:background .2s var(--ease),color .2s}
.nf-tab[aria-selected=true]{background:var(--accent-soft);color:var(--accent-ink);border-color:transparent}
.nf-tab .n{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--like);color:#fff;font-size:11.5px;display:inline-grid;place-items:center;font-variant-numeric:tabular-nums}
.nf-bar{display:flex;align-items:center;gap:8px;margin-bottom:6px}.nf-bar .seg{display:flex;margin:0;flex:none}.nf-bar .seg button{padding:7px 14px;font-size:13px;border:0;font:inherit;font-size:13px;cursor:pointer}
.nf-bar .grow{flex:1}.nf-link{border:0;background:none;color:var(--accent);font:inherit;font-weight:650;font-size:13.5px;cursor:pointer;min-height:44px;padding:0 4px}
.nf-sec{font-size:13px;font-weight:750;color:var(--muted);margin:16px 4px 8px;display:flex;align-items:center;gap:6px}
.nf-sec.imp{color:var(--accent-ink)}
.nf-list{display:flex;flex-direction:column;gap:2px;background:var(--card);border-radius:var(--r);box-shadow:var(--sh-1);overflow:hidden}
.nf-it{position:relative;display:flex;gap:12px;padding:13px 14px;align-items:flex-start;color:inherit;text-decoration:none;transition:background .15s}
.nf-it+.nf-it{border-top:1px solid var(--line)}.nf-it:hover{background:var(--bg)}
.nf-it.un{background:color-mix(in srgb,var(--accent) 8%,var(--card))}.nf-it.un:hover{background:color-mix(in srgb,var(--accent) 12%,var(--card))}
.nf-it.imp::before{content:"";position:absolute;inset-inline-start:0;top:12px;bottom:12px;width:3px;border-radius:3px;background:var(--grad)}
.nf-av{position:relative;flex:none;width:48px;height:44px}
.nf-av .a{position:absolute;width:38px;height:38px;border-radius:13px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:15px;overflow:hidden;box-shadow:0 0 0 2px var(--card)}
.nf-av .a img{width:100%;height:100%;object-fit:cover}
.nf-av .a:nth-child(1){inset-inline-start:0;top:0;z-index:3}.nf-av .a:nth-child(2){inset-inline-start:10px;top:6px;z-index:2;opacity:.95}.nf-av .a:nth-child(3){inset-inline-start:18px;top:10px;z-index:1;opacity:.85}
.nf-av .a.solo{width:44px;height:44px;border-radius:15px}
.nf-av .k{position:absolute;inset-inline-end:-2px;bottom:-4px;z-index:4;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:#fff;box-shadow:0 0 0 2.5px var(--card)}
.nf-av .k .ic{width:12px;height:12px;stroke-width:2.4}
.t-like{background:var(--like)}.t-info{background:var(--info)}.t-ok{background:var(--ok)}.t-warn{background:var(--warn)}.t-danger{background:var(--danger)}.t-accent{background:var(--accent)}
.nf-tx{flex:1;min-width:0;font-size:14.5px;line-height:1.6}.nf-tx b{font-weight:750}
.nf-tx .m{color:var(--muted);font-size:12.5px;margin-top:2px;display:flex;gap:6px;align-items:center}
.nf-tx .q{margin-top:6px;padding:7px 10px;border-radius:10px;background:var(--bg-2);color:var(--text-2);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nf-dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--accent);margin-top:8px}
.nf-mr{flex:none;width:36px;height:36px;margin:-4px -6px 0 0;border-radius:12px;border:0;background:none;color:var(--muted);display:grid;place-items:center;cursor:pointer}
.nf-mr:hover,.nf-mr:focus-visible{background:var(--card);color:var(--accent)}.nf-mr .ic{width:19px;height:19px}
.nf-empty{text-align:center;padding:48px 20px;color:var(--muted)}.nf-empty .ic{width:46px;height:46px;color:var(--line-2);margin-bottom:8px}.nf-empty b{display:block;color:var(--text);font-size:16px;margin-bottom:4px}
.nf-push{display:flex;gap:12px;align-items:center;padding:14px;border-radius:var(--r);background:var(--accent2);margin-bottom:12px}
.nf-push .ic.lg{width:28px;height:28px;color:var(--accent);flex:none}.nf-push .grow{flex:1;font-size:13.5px;line-height:1.55}.nf-push b{display:block;font-size:14.5px}
#nf-toasts{position:fixed;z-index:80;top:calc(env(safe-area-inset-top) + 10px);inset-inline:10px;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.nf-toast{pointer-events:auto;width:min(420px,100%);display:flex;gap:11px;align-items:center;padding:11px 12px;border-radius:20px;background:var(--glass);-webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);box-shadow:var(--sh-3),0 0 0 1px var(--line);color:var(--text);text-decoration:none;cursor:pointer;touch-action:pan-x;
  transform:translateY(-18px) scale(.98);opacity:0;transition:transform .45s var(--ease),opacity .3s var(--ease)}
.nf-toast.on{transform:none;opacity:1}.nf-toast.out{transform:translateY(-14px) scale(.98);opacity:0;transition-duration:.25s}
.nf-toast .nf-av{width:42px;height:40px}.nf-toast .nf-av .a.solo{width:40px;height:40px;border-radius:13px}
.nf-toast .tx{flex:1;min-width:0;font-size:14px;line-height:1.5}.nf-toast .tx small{display:block;color:var(--muted);font-size:12px}
.nf-toast .x{flex:none;width:36px;height:36px;border:0;border-radius:12px;background:none;color:var(--muted);display:grid;place-items:center;cursor:pointer}.nf-toast .x .ic{width:17px;height:17px}
@media (prefers-reduced-motion:reduce){.nf-toast,.nf-toast.out{transform:none!important;transition:opacity .2s linear}}
.nf-card{background:var(--card);border-radius:var(--r);box-shadow:var(--sh-1);padding:14px 16px;margin-bottom:12px}
.nf-card h3{font-size:15.5px;margin:0 0 2px;display:flex;align-items:center;gap:8px}.nf-card h3 .ic{width:19px;height:19px;color:var(--accent)}.nf-card>p{margin:0 0 8px;color:var(--muted);font-size:13px;line-height:1.6}
.nf-row{display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 0}.nf-row+.nf-row{border-top:1px solid var(--line)}
.nf-row .grow{flex:1;min-width:0;font-size:14.5px}.nf-row .grow small{display:block;color:var(--muted);font-size:12.5px;line-height:1.5}
.nf-sw{appearance:none;-webkit-appearance:none;flex:none;width:46px!important;height:28px!important;border-radius:999px;background:var(--line-2);position:relative;cursor:pointer;margin:0;transition:background .2s var(--ease);outline-offset:3px}
.nf-sw::after{content:"";position:absolute;top:3px;inset-inline-start:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0003;transition:inset-inline-start .25s var(--spring)}
.nf-sw:checked{background:var(--accent)}.nf-sw:checked::after{inset-inline-start:21px}.nf-sw:disabled{opacity:.5;cursor:not-allowed}
.nf-sw.s{width:40px!important;height:24px!important}.nf-sw.s::after{width:18px;height:18px}.nf-sw.s:checked::after{inset-inline-start:19px}
@media (forced-colors:active){.nf-sw{border:2px solid ButtonText}.nf-sw:checked::after{background:Highlight}}
.nf-mx .kr{display:grid;grid-template-columns:1fr repeat(3,50px);align-items:center;min-height:52px;border-top:1px solid var(--line)}.nf-mx .kr.h{border:0;min-height:0;position:sticky;top:64px;z-index:2;background:var(--card);padding-top:8px}
.nf-mx .hd{font-size:12px;color:var(--text-2);font-weight:700;text-align:center;line-height:1.25;padding-bottom:6px;display:flex;flex-direction:column;align-items:center;gap:2px}.nf-mx .hd .ic{width:17px;height:17px}
.nf-mx .lb{font-size:14px;padding:10px 0;min-width:0}.nf-mx .cl{display:grid;place-items:center}
.nf-mx .lk{color:var(--muted);display:inline-flex}.nf-mx .lk .ic{width:15px;height:15px}
.nf-grp{font-size:12.5px;font-weight:800;color:var(--accent-ink);margin:16px 0 4px}
.nf-time{display:flex;gap:10px;margin-top:6px}.nf-time label{flex:1;font-size:12.5px;color:var(--muted)}
.nf-time input,.nf-card select{width:100%;margin-top:4px;min-height:44px;font:inherit;font-size:15px;direction:ltr;text-align:center}
.nf-hint{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--muted);line-height:1.6;margin:8px 0 12px}
.nf-page{padding-bottom:calc(var(--nav-h) + 40px)}.nf-hint a,.nf-banner a,.nf-card p a{color:var(--accent-ink);font-weight:650;text-decoration:underline;text-underline-offset:3px}
.nf-card details summary{list-style:none;cursor:pointer;gap:6px}.nf-card details summary::-webkit-details-marker{display:none}.nf-card details summary .ic{transition:transform .2s var(--ease)}.nf-card details[open] summary .ic{transform:rotate(180deg)}.nf-hint .ic{width:16px;height:16px;flex:none;margin-top:2px}
.nf-banner{display:flex;gap:10px;align-items:center;padding:13px 14px;border-radius:var(--r);margin-bottom:12px;background:color-mix(in srgb,var(--ok) 14%,var(--card));color:var(--text);font-size:14px;line-height:1.55}
.nf-banner .ic{width:22px;height:22px;color:var(--ok);flex:none}.nf-banner.warn{background:color-mix(in srgb,var(--warn) 16%,var(--card))}.nf-banner.warn .ic{color:var(--warn)}
.nf-saved{font-size:12.5px;color:var(--ok-ink);min-height:18px;text-align:center;margin:4px 0}
.nf-danger{width:100%;min-height:48px;border-radius:14px;border:1.5px solid color-mix(in srgb,var(--danger) 45%,transparent);background:none;color:var(--danger);font:inherit;font-weight:700;cursor:pointer}
.nf-danger:hover{background:color-mix(in srgb,var(--danger) 8%,transparent)}
.nf-skel{height:70px;border-radius:14px;margin-bottom:8px;background:linear-gradient(90deg,var(--bg-2),var(--card),var(--bg-2));background-size:200% 100%;animation:nfsk 1.2s linear infinite}
@keyframes nfsk{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.nf-skel{animation:none}}
.sr-only{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`;
  (function inject() { if (document.getElementById("nf-css")) return; const s = document.createElement("style"); s.id = "nf-css"; s.textContent = CSS; document.head.appendChild(s);
    document.body.insertAdjacentHTML("beforeend", `<div id="nf-toasts" role="region" aria-label="تنبيهات فورية"></div><div id="nf-say" class="sr-only" aria-live="polite" role="status"></div>`); })();

  const avatarOf = (u, solo) => { const img = u?.avatar && (u.avatar["64"] || u.avatar["200"]); return `<span class="a ${solo ? "solo" : ""}" style="background:${h(u?.color || "var(--accent)")}">${img ? `<img src="${h(img)}" alt="" loading="lazy">` : h((u?.name || "م")[0])}</span>`; };
  const avatars = (g) => { const k = kind(g.kind), list = (g.actors || []).slice(0, 3); const stack = list.length ? list.map(u => avatarOf(u, list.length === 1)).join("") : `<span class="a solo" style="background:var(--grad)">${ic(k.icon)}</span>`;
    return `<span class="nf-av" aria-hidden="true">${stack}<span class="k t-${k.tone}">${ic(k.icon)}</span></span>`; };
  const sentenceHtml = (g) => { const names = g.names && g.actors?.length ? g.names : ""; const t = String(g.text || "").replace(/\s*\p{Extended_Pictographic}[\uFE0F\u200D]*/gu, ""); /* v2.54: server verbs may carry emoji (tofu without an emoji font) */ return names && t.startsWith(names) ? `<b>${h(names)}</b>${h(t.slice(names.length))}` : h(t); };
  const quoteOf = (g) => { const p = g.post && S.post?.(g.post); const t = p ? (p.title || p.text || "") : ""; return t ? `<div class="q">${h(t.slice(0, 90))}</div>` : ""; };

  /* ---------- notification center ---------- */
  const st = { tab: "all", sort: "rank", data: null };
  function row(g) {
    const un = !g.read;
    return `<a class="nf-it ${un ? "un" : ""} ${g.important ? "imp" : ""}" href="${h(g.href || "#/notifications")}" data-g="${h(g.key)}">
      ${avatars(g)}<div class="nf-tx">${sentenceHtml(g)}${quoteOf(g)}<div class="m"><time datetime="${h(g.at)}">${h(relTime(g.at))}</time>${g.count > 1 ? `<span aria-hidden="true">·</span><span>${g.count} إشعارات</span>` : ""}${un ? '<span class="sr-only">غير مقروء</span>' : ""}</div></div>
      ${un ? `<button class="nf-mr" data-mr="${h(g.key)}" aria-label="تعليم كمقروء" title="تعليم كمقروء">${ic("check")}</button>` : ""}</a>`;
  }
  function sections(groups, sort) {
    if (!groups.length) return "";
    if (sort === "rank") {
      const imp = groups.filter(g => g.important), rest = groups.filter(g => !g.important);
      return (imp.length ? `<div class="nf-sec imp">${ic("sparkle")} يستحق انتباهك</div><div class="nf-list">${imp.map(row).join("")}</div>` : "") +
        (rest.length ? `<div class="nf-sec">${imp.length ? "المزيد" : "حسب الأهمية"}</div><div class="nf-list">${rest.map(row).join("")}</div>` : "");
    }
    const day = 864e5, t0 = new Date().setHours(0, 0, 0, 0), b = { "اليوم": [], "هذا الأسبوع": [], "أقدم": [] };
    for (const g of groups) { const t = new Date(g.at).getTime(); (t >= t0 ? b["اليوم"] : t >= t0 - 6 * day ? b["هذا الأسبوع"] : b["أقدم"]).push(g); }
    return Object.entries(b).filter(([, v]) => v.length).map(([k, v]) => `<div class="nf-sec">${k}</div><div class="nf-list">${v.map(row).join("")}</div>`).join("");
  }
  const EMPTY = { all: ["bell", "لا إشعارات بعد", "سنخبرك هنا عندما يتفاعل أحد معك."], mentions: ["at", "لا إشارات", "عندما يذكرك أحد أو يرد عليك ستجده هنا."], follows: ["userPlus", "لا متابعات جديدة", "المتابعون الجدد وطلبات المتابعة تظهر هنا."],
    interactions: ["heart", "لا تفاعلات بعد", "الإعجابات والتعليقات على منشوراتك تظهر هنا."], communities: ["community", "لا جديد من مجتمعاتك", "الدعوات وطلبات الانضمام والأحداث تظهر هنا."] };
  function pushNudge() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || Notification.permission !== "default" || localStorage.getItem("mp-push-nudge") === "x") return "";
    return `<div class="nf-push">${ic("bell", "lg")}<div class="grow"><b>لا تفوّت ما يهمك</b>فعّل الإشعارات على هذا الجهاز، وتحكّم بما يصلك وأوقات الهدوء.</div><button class="btn" id="nf-en">تفعيل</button><button class="nf-mr" id="nf-nx" aria-label="ليس الآن">${ic("x")}</button></div>`;
  }
  async function center() {
    const token = Symbol(); view._nf = token;
    if (!(view.firstElementChild && view.firstElementChild.classList.contains("nf-page"))) view.innerHTML = `<div class="wrap nf-page" aria-busy="true"><div class="nf-head"><h2>الإشعارات</h2></div>${'<div class="nf-skel"></div>'.repeat(5)}</div>`;
    let d; try { d = await loadCenter(st.tab, st.sort); } catch (e) { if (view._nf === token) view.innerHTML = `<div class="wrap nf-page"><div class="empty err" role="alert">${ic("offline")}<span class="empty-t">تعذّر تحميل الإشعارات</span><span class="empty-x">${h(e.message)}</span><button class="btn" data-ui="route">إعادة المحاولة</button></div></div>`; return; }
    if (view._nf !== token || !/^#\/notifications/.test(location.hash || "#/")) return;
    st.data = d;
    const tabs = TABS.map(([key, label]) => ({ key, label, unread: (d.tabs || []).find(t => t.key === key)?.unread || 0 }));
    const anyUnread = d.groups.some(g => !g.read), e = EMPTY[st.tab] || EMPTY.all;
    const focusTab = document.activeElement?.dataset?.tab;
    view.innerHTML = `<div class="wrap nf-page">
      <div class="nf-head"><h2 id="nf-h">الإشعارات</h2>
        <a class="nf-ib" href="#/notifsettings" aria-label="إعدادات الإشعارات" title="إعدادات الإشعارات">${ic("settings")}</a></div>
      ${pushNudge()}
      <div class="nf-tabs" role="tablist" aria-labelledby="nf-h">${tabs.map(t => `<button class="nf-tab" role="tab" id="nft-${t.key}" data-tab="${t.key}" aria-selected="${st.tab === t.key}" aria-controls="nf-panel" tabindex="${st.tab === t.key ? 0 : -1}">${h(t.label)}${t.unread ? `<span class="n" aria-label="${t.unread} غير مقروء">${t.unread > 99 ? "99+" : t.unread}</span>` : ""}</button>`).join("")}</div>
      <div class="nf-bar"><div class="seg" role="group" aria-label="الترتيب"><button data-sort="rank" class="${st.sort === "rank" ? "on" : ""}" aria-pressed="${st.sort === "rank"}">الأهم</button><button data-sort="new" class="${st.sort === "new" ? "on" : ""}" aria-pressed="${st.sort === "new"}">الأحدث</button></div><span class="grow"></span>
        ${anyUnread ? `<button class="nf-link" id="nf-all">${ic("checks", "sm")} تعليم ${st.tab === "all" ? "الكل" : "التبويب"} كمقروء</button>` : ""}</div>
      <div id="nf-panel" role="tabpanel" aria-labelledby="nft-${st.tab}">${sections(d.groups, st.sort) || `<div class="nf-empty">${ic(e[0])}<b>${e[1]}</b>${e[2]}</div>`}</div></div>`;
    if (focusTab) view.querySelector(`[data-tab="${focusTab}"]`)?.focus();
    wireCenter();
  }
  function wireCenter() {
    const tabs = [...view.querySelectorAll(".nf-tab")];
    tabs.forEach((b, i) => { b.onclick = () => { st.tab = b.dataset.tab; center(); };
      b.onkeydown = (e) => { const dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0; if (e.key === "Home" || e.key === "End") { e.preventDefault(); const t = tabs[e.key === "Home" ? 0 : tabs.length - 1]; t.focus(); t.click(); } if (!dir) return; e.preventDefault(); const t = tabs[(i + dir + tabs.length) % tabs.length]; t.focus(); t.click(); }; });
    { const on = view.querySelector(".nf-tab[aria-selected=true]"); if (on && on !== view.querySelector(".nf-tab")) requestAnimationFrame(() => setTimeout(() => on.isConnected && on.scrollIntoView?.({ block: "nearest", inline: "nearest" }), 0)); } // v2.52: after the first paint
    view.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { st.sort = b.dataset.sort; center(); });
    const all = view.querySelector("#nf-all"); if (all) all.onclick = async () => { all.disabled = true; try { await markRead(st.tab === "all" ? {} : { tab: st.tab }); say("تم تعليم الإشعارات كمقروءة"); } catch (e) { toast(e.message); } center(); };
    const find = (k) => st.data?.groups.find(g => g.key === k);
    view.querySelectorAll("[data-mr]").forEach(b => b.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); const g = find(b.dataset.mr); if (!g) return; const it = b.closest(".nf-it"); it.classList.remove("un", "imp"); b.remove(); g.read = true; say("تم التعليم كمقروء"); markRead({ ids: g.ids }).catch(() => { }); });
    view.querySelectorAll(".nf-it[data-g]").forEach(a => a.addEventListener("click", () => { const g = find(a.dataset.g); if (g && !g.read) markRead({ ids: g.ids }).catch(() => { }); }));
    const en = view.querySelector("#nf-en"); if (en) en.onclick = () => enablePush().then(() => center());
    const nx = view.querySelector("#nf-nx"); if (nx) nx.onclick = () => { localStorage.setItem("mp-push-nudge", "x"); nx.closest(".nf-push").remove(); };
  }

  /* ---------- in-app toasts ---------- */
  const TOAST_MS = 5200;
  let burst = [], burstT = 0;
  /* a burst (several within 700 ms, e.g. after reconnecting) becomes one summary toast instead of a stack */
  function showToast(n) {
    if (!n || document.hidden || n.kind === "call") return;
    burst.push(n); clearTimeout(burstT);
    burstT = setTimeout(() => { const list = burst; burst = []; if (list.length === 1) return toastOne(list[0]);
      const last = list[list.length - 1]; toastOne({ ...last, id: null, summary: list.length, ids: list.map(x => x.id).filter(Boolean) }); }, 700);
  }
  addEventListener("hashchange", () => { if (/^#\/notifications/.test(location.hash)) document.querySelectorAll(".nf-toast").forEach(t => t.remove()); });
  function toastOne(n) {
    const k = kind(n.kind);
    if (/^#\/notifications/.test(location.hash)) { center(); return; }                     // the list itself updates instead
    if ((n.kind === "message" || n.kind === "call") && /^#\/chat\//.test(location.hash)) return; // chat / calls UIs own these
    if (n.kind === "call") return;                                                          // the incoming-call sheet shows calls
    const box = document.getElementById("nf-toasts"); if (!box) return;
    while (box.children.length >= 3) box.firstElementChild.remove();
    const a = n.actorInfo || (n.actor && S.user?.(n.actor)) || null;
    const one = String(n.text || (k.system && !a ? verb(n.kind, 1) : `${a?.name || "مجتمع بلس"} ${verb(n.kind, 1)}`)).replace(/\s*\p{Extended_Pictographic}[\uFE0F\u200D]*/gu, "");
    const text = n.summary ? `لديك ${n.summary} إشعارات جديدة` : one;
    const href = n.summary ? "#/notifications" : n.href ? (n.href.startsWith("#") ? n.href : "#" + n.href.replace(/^\/?#?/, "")) : n.post ? "#/post/" + n.post : "#/notifications";
    const el = document.createElement("div"); el.className = "nf-toast"; el.setAttribute("role", "status");
    el.innerHTML = `${avatars({ kind: n.kind, actors: a ? [a] : [] })}<div class="tx">${a && !n.summary && text.startsWith(a.name) ? `<b>${h(a.name)}</b>${h(text.slice(a.name.length))}` : n.summary ? `<b>${h(text)}</b>` : h(text)}<small>${n.summary ? "آخرها: " + h(one) : "الآن · اضغط للفتح"}</small></div><button class="x" aria-label="إغلاق التنبيه">${ic("x")}</button>`;
    box.appendChild(el); say(text);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
    let timer = null, left = TOAST_MS, started = Date.now();
    const close = () => { clearTimeout(timer); el.classList.add("out"); el.classList.remove("on"); setTimeout(() => el.remove(), reduced() ? 200 : 300); };
    const arm = () => { started = Date.now(); timer = setTimeout(close, left); };
    const hold = () => { clearTimeout(timer); left = Math.max(1500, left - (Date.now() - started)); };
    el.addEventListener("mouseenter", hold); el.addEventListener("mouseleave", arm); el.addEventListener("focusin", hold); el.addEventListener("focusout", arm);
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    el.querySelector(".x").onclick = (e) => { e.stopPropagation(); close(); };
    el.onclick = () => { close(); if (n.id) markRead({ ids: [n.id] }).catch(() => { }); location.hash = href; };
    let y0 = null; el.addEventListener("pointerdown", (e) => { y0 = e.clientY; }); el.addEventListener("pointerup", (e) => { if (y0 !== null && y0 - e.clientY > 24) { e.stopPropagation(); close(); } y0 = null; });
    arm();
  }
  /* realtime feed: MPNotify events first, otherwise the app's SSE stream (re-bound when it reconnects) */
  let boundEs = null;
  const onSse = (e) => { try { showToast(JSON.parse(e.data)); } catch { } };
  function bindStream() {
    if (has("on")) return;
    const es = online() && Remote.es; if (!es || es === boundEs) return;
    boundEs = es; es.addEventListener("notification", onSse);
  }
  if (has("on")) N().on("notification", showToast); else { bindStream(); setInterval(bindStream, 4000); }
  addEventListener("mp:notification", (e) => showToast(e.detail));

  /* ---------- push ---------- */
  const b64u = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  /** "on" | "off" | "denied" | "unsupported" | "needs-install" */
  const within = (pr, ms, v) => Promise.race([pr, new Promise(r => setTimeout(() => r(v), ms))]); // serviceWorker.ready never settles without a worker
  async function pushState() { return within(pushState0(), 2000, "off"); }
  async function pushState0() {
    if (has("pushState")) { try { const st = await N().pushState(); return st.permission === "needs-install" ? "needs-install" : !st.supported ? "unsupported" : st.permission === "denied" ? "denied" : st.subscribed ? "on" : "off"; } catch { return "off"; } }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub ? "on" : "off"; } catch { return "off"; }
  }
  const PUSH_FAIL = { denied: "رفض المتصفح الإذن. اسمح بالإشعارات من إعدادات الموقع", default: "لم يُمنح الإذن", unsupported: "هذا المتصفح لا يدعم إشعارات الدفع", "needs-install": "أضف التطبيق إلى الشاشة الرئيسية أولاً ثم فعّل الإشعارات" };
  async function enablePush() {
    try {
      if (!online()) throw new Error("تفعيل الإشعارات يحتاج الاتصال بالخادم");
      if (has("enablePush")) { const r = await N().enablePush(); if (r && r.ok === false) throw new Error(PUSH_FAIL[r.reason] || "تعذّر التفعيل"); }
      else {
        const perm = await Notification.requestPermission(); if (perm !== "granted") throw new Error(PUSH_FAIL[perm]);
        const reg = await navigator.serviceWorker.ready, { publicKey } = await api("GET", "/api/push/vapid");
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(publicKey) });
        await api("POST", "/api/push/subscribe", sub.toJSON());
      }
      toast("فُعّلت الإشعارات على هذا الجهاز ✓"); say("فُعّلت الإشعارات على هذا الجهاز");
    } catch (e) { toast(e.message || "تعذّر التفعيل"); }
  }
  async function disablePush() {
    if (has("disablePush")) return N().disablePush();
    const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription(); if (!sub) return;
    if (online()) await api("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => { });
    await sub.unsubscribe();
  }

  /* ---------- settings ---------- */
  const TAB_LABEL = { mentions: "الإشارات والردود", follows: "المتابعات", interactions: "التفاعلات", communities: "المجتمعات", messages: "الرسائل والمكالمات", system: "الحساب والنظام" };
  const LOCAL_LABEL = { mention: "الإشارات إليك", reply: "الردود على تعليقاتك", follow: "متابعون جدد", follow_request: "طلبات المتابعة", reaction: "الإعجابات والتفاعلات", comment: "التعليقات", join_request: "طلبات الانضمام", invite: "الدعوات", event: "تذكيرات الأحداث", message_request: "طلبات المراسلة", call_missed: "المكالمات الفائتة", removed: "قرارات الإشراف", video: "معالجة الفيديو" };
  async function loadSettings() {
    if (online()) {
      try { return has("settings") ? await N().settings() : await api("GET", "/api/notify/settings"); } catch (e) { if (e.status === 401) throw e; }
    }
    const s = DB.settings.notifyV2 ||= { channels: {}, quiet: { enabled: false, start: "22:00", end: "07:00", tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Riyadh", allowUrgent: true }, emailNotify: true };
    const def = { inapp: 1, push: 1, email: 0 };
    return { local: true, quiet: s.quiet, emailNotify: s.emailNotify, kinds: Object.keys(LOCAL_LABEL).map(k => ({ kind: k, label: LOCAL_LABEL[k], tab: kind(k).tab, ...def, ...(s.channels[k] || {}), lock: [] })), email: { address: null }, push: {} };
  }
  async function saveSettings(body, local) {
    if (local || !online()) { const s = DB.settings.notifyV2; if (body.channels) for (const [k, v] of Object.entries(body.channels)) s.channels[k] = { ...(s.channels[k] || {}), ...v }; if (body.quiet) s.quiet = { ...s.quiet, ...body.quiet }; if (body.emailNotify !== undefined) s.emailNotify = body.emailNotify; save(); return null; }
    return has("saveSettings") ? N().saveSettings(body) : api("PUT", "/api/notify/settings", body);
  }
  const zones = () => { try { return Intl.supportedValuesOf("timeZone"); } catch { return ["Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar", "Africa/Cairo", "Asia/Amman", "Asia/Baghdad", "Africa/Casablanca", "Europe/London", "Europe/Istanbul", "America/New_York", "UTC"]; } };
  const zoneLabel = (z) => { try { const p = new Intl.DateTimeFormat("ar", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(new Date()).find(x => x.type === "timeZoneName")?.value || ""; return `${z.replace(/_/g, " ")} (${p})`; } catch { return z; } };
  async function settingsView() {
    const token = Symbol(); view._nf = token;
    view.innerHTML = `<div class="wrap nf-page" aria-busy="true">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "الإشعارات والبريد", icon: "bell" })}${'<div class="nf-skel"></div>'.repeat(4)}</div>`;
    let s; try { s = await loadSettings(); } catch (e) { if (view._nf === token) view.innerHTML = `<div class="wrap"><div class="nf-empty"><b>تعذّر تحميل الإعدادات</b>${h(e.message)}</div></div>`; return; }
    const ps = await pushState(); if (view._nf !== token) return;
    const q = s.quiet || {}, byTab = {};
    for (const k of s.kinds || []) (byTab[k.tab] ||= []).push(k);
    const tz = q.tz || "Asia/Riyadh", zl = zones(); if (!zl.includes(tz)) zl.unshift(tz);
    const pushCard = { on: ["الإشعارات مفعّلة على هذا الجهاز", "تصلك التنبيهات حتى والتطبيق مغلق.", `<button class="btn ghost" id="ns-test">إرسال تجريبي</button>`],
      off: ["الإشعارات غير مفعّلة على هذا الجهاز", "فعّلها لتصلك الرسائل والإشارات المهمة فوراً. سيطلب المتصفح إذنك.", `<button class="btn" id="ns-push">تفعيل</button>`],
      denied: ["المتصفح يمنع الإشعارات", "اسمح بها من إعدادات الموقع في المتصفح ثم عد إلى هنا.", ""],
      unsupported: ["هذا المتصفح لا يدعم إشعارات الدفع", "جرّب متصفحاً حديثاً، أو اكتفِ بالإشعارات داخل التطبيق والبريد.", ""],
      "needs-install": ["أضف التطبيق إلى الشاشة الرئيسية", "على iPhone وiPad (iOS 16.4+) تعمل الإشعارات بعد «مشاركة ← إضافة إلى الشاشة الرئيسية».", ""] }[ps];
    const col = (k, c) => { const locked = (k.lock || []).includes(c); return `<span class="cl">${locked ? `<span class="lk" role="img" title="لا يمكن إيقافه لحماية حسابك" aria-label="مفعّل دائماً">${ic("lock")}</span>` : `<input type="checkbox" class="nf-sw s" role="switch" data-k="${h(k.kind)}" data-c="${c}" ${k[c] ? "checked" : ""} aria-label="${h(k.label)}: ${{ inapp: "داخل التطبيق", push: "الدفع", email: "البريد" }[c]}">`}</span>`; };
    view.innerHTML = `<div class="wrap nf-page">
      ${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "الإشعارات والبريد", icon: "bell" })}
      <section class="nf-card" aria-labelledby="ns-p"><div class="nf-row"><div class="grow"><b id="ns-p">${pushCard[0]}</b><small>${pushCard[1]}</small></div>${pushCard[2]}</div>
        ${ps === "on" ? `<div class="nf-row"><div class="grow">إيقاف على هذا الجهاز</div><input type="checkbox" class="nf-sw" role="switch" id="ns-off" checked aria-label="الإشعارات على هذا الجهاز"></div>` : ""}</section>
      <section class="nf-card" aria-labelledby="ns-q"><h3 id="ns-q">${ic("moon")} أوقات الهدوء</h3><p>نؤجّل إشعارات الدفع إلى نهاية الفترة، وتبقى كلها في مركز الإشعارات.</p>
        <div class="nf-row"><div class="grow">تفعيل أوقات الهدوء</div><input type="checkbox" class="nf-sw" role="switch" id="ns-qe" ${q.enabled ? "checked" : ""} aria-label="تفعيل أوقات الهدوء"></div>
        <div id="ns-qb" ${q.enabled ? "" : "hidden"}><div class="nf-time"><label>من<input type="time" id="ns-qs" value="${h(q.start || "22:00")}"></label><label>إلى<input type="time" id="ns-qn" value="${h(q.end || "07:00")}"></label></div>
          <label class="u-db u-t-xs u-c-mu u-mt10">المنطقة الزمنية<select id="ns-tz">${zl.map(z => `<option value="${h(z)}" ${z === tz ? "selected" : ""}>${h(zoneLabel(z))}</option>`).join("")}</select></label>
          <button class="nf-link" id="ns-tzd">${ic("globe", "sm")} استخدم منطقة هذا الجهاز</button>
          <div class="nf-row"><div class="grow">السماح بالعاجل<small>المكالمات وتنبيهات الأمان تصلك دائماً</small></div><input type="checkbox" class="nf-sw" role="switch" id="ns-qu" ${q.allowUrgent !== false ? "checked" : ""} aria-label="السماح بالإشعارات العاجلة"></div></div></section>
      <section class="nf-card" aria-labelledby="ns-k"><h3 id="ns-k">${ic("bell")} ما يصلك وكيف</h3><p>اختر لكل نوع: داخل التطبيق، إشعار الدفع، أو البريد.</p>
        <div class="nf-mx" role="group" aria-label="القنوات لكل نوع"><div class="kr h" aria-hidden="true"><span></span><span class="hd">${ic("bell")}التطبيق</span><span class="hd">${ic("device")}الدفع</span><span class="hd">${ic("mail")}البريد</span></div>
        ${Object.keys(TAB_LABEL).filter(t => byTab[t]).map(t => `<div class="nf-grp">${TAB_LABEL[t]}</div>${byTab[t].map(k => `<div class="kr"><span class="lb">${h(k.label)}</span>${col(k, "inapp")}${col(k, "push")}${col(k, "email")}</div>`).join("")}`).join("")}</div>
        <div class="nf-hint">${ic("lock")} تنبيهات الأمان تصلك داخل التطبيق وبالبريد دائماً لحماية حسابك.</div></section>
      <a class="u-dflex u-ci u-tdn nf-card nf-row" href="#/emailprefs">${ic("mail")}<div class="grow"><b>تفضيلات البريد</b><small>${s.email?.address ? h(s.email.address) + " · " : ""}الملخصات، التنبيهات، إلغاء الاشتراك</small></div><span class="fwd" aria-hidden="true">←</span></a>
      <div class="nf-saved" id="ns-saved" role="status" aria-live="polite"></div></div>`;
    let pending = {}, t = null;
    const flush = async () => { const body = pending; pending = {}; try { await saveSettings(body, s.local); const m = document.getElementById("ns-saved"); if (m) { m.textContent = "✓ تم الحفظ"; setTimeout(() => { if (m.textContent === "✓ تم الحفظ") m.textContent = ""; }, 1800); } } catch (e) { toast(e.message || "تعذّر الحفظ"); settingsView(); } };
    const queue = (patch) => { if (patch.channels) pending.channels = { ...(pending.channels || {}), ...Object.fromEntries(Object.entries(patch.channels).map(([k, v]) => [k, { ...(pending.channels?.[k] || {}), ...v }])) }; if (patch.quiet) pending.quiet = { ...(pending.quiet || {}), ...patch.quiet }; clearTimeout(t); t = setTimeout(flush, 450); };
    view.querySelectorAll("[data-k]").forEach(c => c.onchange = () => queue({ channels: { [c.dataset.k]: { [c.dataset.c]: c.checked } } }));
    const v = (id) => document.getElementById(id);
    v("ns-qe").onchange = (e) => { v("ns-qb").hidden = !e.target.checked; queue({ quiet: { enabled: e.target.checked } }); };
    v("ns-qs").onchange = (e) => queue({ quiet: { start: e.target.value } }); v("ns-qn").onchange = (e) => queue({ quiet: { end: e.target.value } });
    v("ns-tz").onchange = (e) => queue({ quiet: { tz: e.target.value } }); v("ns-qu").onchange = (e) => queue({ quiet: { allowUrgent: e.target.checked } });
    v("ns-tzd").onclick = () => { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (!z) return; const sel = v("ns-tz"); if (![...sel.options].some(o => o.value === z)) sel.insertAdjacentHTML("afterbegin", `<option value="${h(z)}">${h(zoneLabel(z))}</option>`); sel.value = z; queue({ quiet: { tz: z } }); say("تم ضبط المنطقة الزمنية: " + z); };
    if (v("ns-push")) v("ns-push").onclick = () => enablePush().then(settingsView);
    if (v("ns-off")) v("ns-off").onchange = () => disablePush().then(settingsView);
    if (v("ns-test")) v("ns-test").onclick = async () => { try { if (has("testPush")) await N().testPush(); else await api("POST", "/api/push/test"); toast("أُرسل إشعار تجريبي"); } catch (e) { toast(e.message); } };
  }

  /* ---------- email preferences (+ unsubscribe / verify landings) ---------- */
  const params = () => new URLSearchParams((location.hash.split("?")[1] || ""));
  const CAT = (c) => c === "weekly" ? "النشرة الأسبوعية" : c === "notify" ? "رسائل الإشعارات" : c === "all" ? "كل الرسائل غير الضرورية" : String(c || "").startsWith("notify:") ? "هذا النوع من رسائل الإشعارات" : "هذه الرسائل";
  async function loadEmail() {
    if (!online()) return { local: true, weekly: !!DB.settings.emailWeekly, notifyEmails: DB.settings.notifyV2?.emailNotify !== false, kinds: [] };
    return has("emailPrefs") ? N().emailPrefs() : api("GET", "/api/email/prefs");
  }
  async function saveEmail(body) {
    if (!online()) { if (body.weekly !== undefined) DB.settings.emailWeekly = body.weekly; if (body.notifyEmails !== undefined) (DB.settings.notifyV2 ||= { channels: {}, quiet: {} }).emailNotify = body.notifyEmails; save(); return null; }
    return has("saveEmailPrefs") ? N().saveEmailPrefs(body) : api("PUT", "/api/email/prefs", body);
  }
  async function emailView() {
    const token = Symbol(); view._nf = token;
    const P = params(), unsub = P.get("unsubscribed"), verified = P.get("verified");
    if (!(view.firstElementChild && view.firstElementChild.classList.contains("nf-page"))) view.innerHTML = `<div class="wrap nf-page" aria-busy="true"><div class="nf-head"><h2>تفضيلات البريد</h2></div>${'<div class="nf-skel"></div>'.repeat(3)}</div>`;
    let p; try { p = await loadEmail(); } catch (e) { if (view._nf === token) view.innerHTML = `<div class="wrap nf-page"><div class="nf-head"><h2>تفضيلات البريد</h2></div><div class="nf-banner warn">${ic("info")}<div>${e.status === 401 ? "سجّل الدخول لإدارة تفضيلات بريدك." : h(e.message)}</div></div></div>`; return; }
    if (view._nf !== token) return;
    const allOff = !p.weekly && p.notifyEmails === false, sup = p.suppressed, kinds = (p.kinds || []).filter(k => !k.locked);
    const banner = unsub ? `<div class="nf-banner" role="status">${ic("check")}<div class="grow"><b>تم إلغاء اشتراكك من ${h(CAT(unsub))}.</b><br>يمكنك تعديل اختيارك في أي وقت من هذه الصفحة.</div></div>`
      : verified === "1" ? `<div class="nf-banner" role="status">${ic("check")}<div><b>تم تأكيد بريدك الإلكتروني ✓</b><br>ستصلك تنبيهات الأمان والرسائل التي تختارها هنا.</div></div>`
      : verified === "0" ? `<div class="nf-banner warn" role="status">${ic("info")}<div><b>رابط التأكيد غير صالح أو منتهي.</b><br>أرسل رابطاً جديداً من الأسفل.</div></div>` : "";
    const supBanner = sup === "unsubscribed" || sup === "complaint" ? `<div class="nf-banner warn">${ic("bellOff")}<div class="grow">أوقفت كل الرسائل غير الضرورية لهذا العنوان.</div><button class="btn ghost" id="ep-re">إعادة الاشتراك</button></div>`
      : sup === "hard_bounce" || sup === "soft_bounce" ? `<div class="nf-banner warn">${ic("info")}<div>تعذّر توصيل الرسائل إلى هذا العنوان، فأوقفنا الإرسال إليه. غيّر بريدك من <a href="#/security">الأمان</a>.</div></div>` : "";
    view.innerHTML = `<div class="wrap nf-page">
      <div class="nf-head">${online() ? `<a class="nf-ib" href="#/notifsettings" aria-label="رجوع إلى إعدادات الإشعارات">${ic("back")}</a>` : ""}<h2>تفضيلات البريد</h2></div>
      ${banner}${supBanner}
      ${p.email ? `<div class="nf-card nf-row">${ic("mail")}<div class="grow"><b dir="ltr" style="unicode-bidi:plaintext;display:block;text-align:start">${h(p.email)}</b><small>${p.verified ? "مؤكَّد · البريد المرتبط بحسابك" : "غير مؤكَّد · لن تصلك الرسائل قبل تأكيده"}</small></div>${p.verified ? "" : `<button class="btn ghost" id="ep-rs">إعادة الإرسال</button>`}</div>`
        : online() ? `<div class="nf-banner warn">${ic("info")}<div>لم تُضف بريداً إلكترونياً بعد. أضفه من <a href="#/security">الأمان</a> لاستلام الملخصات والتنبيهات.</div></div>` : ""}
      ${p.mailEnabled === false ? `<div class="nf-hint">${ic("info")} إرسال البريد غير مفعّل على هذا الخادم حالياً؛ تُحفظ اختياراتك وتُطبَّق عند تفعيله.</div>` : ""}
      <section class="nf-card" aria-labelledby="ep-d"><h3 id="ep-d">${ic("calendar")} الملخص بالبريد</h3><p>أبرز ما فاتك من الأشخاص والمجتمعات التي تتابعها.</p>
        <div class="u-dflex seg" role="radiogroup" aria-labelledby="ep-d">${[["weekly", "أسبوعياً"], ["off", "متوقف"]].map(([k, l]) => { const on = (p.weekly ? "weekly" : "off") === k; return `<button role="radio" aria-checked="${on}" class="${on ? "on" : ""}" data-dg="${k}" tabindex="${on ? 0 : -1}">${l}</button>`; }).join("")}</div>
        <div class="nf-hint">${ic("sparkle")} الملخص اليومي متاح داخل التطبيق في <a href="#/digest">«فاتك اليوم»</a></div></section>
      <section class="nf-card" aria-labelledby="ep-t"><h3 id="ep-t">${ic("bell")} التنبيهات بالبريد</h3>
        <div class="nf-row"><div class="grow">إشعارات النشاط<small>تصلك بالبريد فقط إن لم تقرأها في التطبيق خلال دقائق</small></div><input type="checkbox" class="nf-sw" role="switch" id="ep-n" ${p.notifyEmails !== false ? "checked" : ""} aria-label="إشعارات النشاط بالبريد"></div>
        ${kinds.length ? `<details id="ep-kd" ${p.notifyEmails === false ? "" : ""}><summary class="u-dflex u-aic nf-link">${ic("down", "sm")} <span>اختيار الأنواع</span> <bdi dir="ltr">(${kinds.filter(k => k.email).length}/${kinds.length})</bdi></summary>${kinds.map(k => `<div class="nf-row"><div class="grow">${h(k.label)}</div><input type="checkbox" class="nf-sw s" role="switch" data-ek="${h(k.kind)}" ${k.email ? "checked" : ""} ${p.notifyEmails === false ? "disabled" : ""} aria-label="${h(k.label)} بالبريد"></div>`).join("")}</details>` : ""}
        <div class="nf-row"><div class="grow">تنبيهات الأمان والحساب<small>دخول من جهاز جديد، تغيير كلمة المرور أو البريد، الاستعادة</small></div><span class="u-c-mu u-dif lk" role="img" title="مفعّل دائماً" aria-label="مفعّل دائماً لحماية حسابك">${ic("lock")}</span></div></section>
      <button class="nf-danger" id="ep-all" ${allOff ? "disabled" : ""}>${allOff ? "أنت غير مشترك في أي رسائل اختيارية" : "إلغاء الاشتراك من كل الرسائل"}</button>
      <div class="u-jcc nf-hint">${ic("shield")} تنبيهات الأمان ضرورية لحماية حسابك ولا يمكن إيقافها.</div>
      <div class="nf-saved" id="ep-saved" role="status" aria-live="polite"></div></div>`;
    const done = () => { const m = document.getElementById("ep-saved"); if (m) { m.textContent = "✓ تم الحفظ"; setTimeout(() => { if (m.textContent === "✓ تم الحفظ") m.textContent = ""; }, 1800); } };
    const run = async (body, again) => { try { const r = await saveEmail(body); if (r) Object.assign(p, r); else Object.assign(p, body); done(); if (again) emailView(); } catch (e) { toast(e.message || "تعذّر الحفظ"); emailView(); } };
    const radios = [...view.querySelectorAll("[data-dg]")];
    radios.forEach((b, i) => { b.onclick = () => { radios.forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); x.tabIndex = on ? 0 : -1; }); run({ weekly: b.dataset.dg === "weekly" }); };
      b.onkeydown = (e) => { const d = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0; if (!d) return; e.preventDefault(); const n = radios[(i + d + radios.length) % radios.length]; n.focus(); n.click(); }; });
    document.getElementById("ep-n").onchange = (e) => { view.querySelectorAll("[data-ek]").forEach(x => (x.disabled = !e.target.checked)); run({ notifyEmails: e.target.checked }); };
    view.querySelectorAll("[data-ek]").forEach(x => x.onchange = () => run({ kinds: { [x.dataset.ek]: x.checked } }));
    const re = document.getElementById("ep-re"); if (re) re.onclick = () => run({ resubscribe: true }, true);
    const rs = document.getElementById("ep-rs"); if (rs) rs.onclick = async () => { rs.disabled = true; try { if (has("resendVerification")) await N().resendVerification(); else await api("POST", "/api/account/email/resend"); toast("أرسلنا رابط تأكيد جديداً"); } catch (e) { toast(e.message); rs.disabled = false; } };
    const all = document.getElementById("ep-all");
    all.onclick = () => {
      const s = sheet(`<h4 class="u-mt0">إلغاء الاشتراك من كل الرسائل؟</h4><p class="u-lh17 muted">نوقف النشرة الأسبوعية وإشعارات النشاط بالبريد. تبقى تنبيهات الأمان فقط، وتظل إشعاراتك داخل التطبيق كما هي.</p>
        <button class="u-bg-dg btn block" id="ep-yes">نعم، ألغِ الاشتراك</button><button class="u-mt8 btn ghost block" id="ep-no">تراجع</button>`);
      s.querySelector("#ep-yes").focus();
      s.querySelector("#ep-no").onclick = () => { closeSheet(); all.focus(); };
      s.querySelector("#ep-yes").onclick = async () => { closeSheet(); const before = { weekly: !!p.weekly, notifyEmails: p.notifyEmails !== false };
        await run({ weekly: false, notifyEmails: false }, true);
        const box = document.getElementById("nf-toasts"); if (!box) return; // undo affordance
        const el = document.createElement("div"); el.className = "nf-toast"; el.setAttribute("role", "status"); el.innerHTML = `<div class="tx"><b>ألغيت اشتراكك من كل الرسائل</b><small>تصلك تنبيهات الأمان فقط</small></div><button class="btn ghost" id="ep-undo">تراجع</button>`;
        box.appendChild(el); requestAnimationFrame(() => el.classList.add("on")); say("ألغيت اشتراكك من كل الرسائل. يمكنك التراجع");
        const kill = setTimeout(() => el.remove(), 8000);
        el.querySelector("#ep-undo").onclick = async (e) => { e.stopPropagation(); clearTimeout(kill); el.remove(); await run(before, true); say("استعدنا اشتراكاتك"); };
      };
    };
  }
  /* #/unsubscribe?t=… — in-app landing for an unsubscribe link: one-click POST, then the preferences page */
  async function unsubscribeLanding() {
    const t = params().get("t");
    view.innerHTML = `<div class="wrap nf-page"><div class="nf-head"><h2>إلغاء الاشتراك</h2></div><div class="nf-skel"></div></div>`;
    try {
      if (!t) throw new Error("رابط إلغاء الاشتراك غير مكتمل");
      const r = await fetch("/api/email/unsubscribe?t=" + encodeURIComponent(t), { method: "POST", headers: { Accept: "application/json" }, credentials: "same-origin" });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "رابط إلغاء الاشتراك غير صالح");
      if (online()) location.replace("#/emailprefs?unsubscribed=" + encodeURIComponent(j.category || "all"));
      else view.innerHTML = `<div class="wrap nf-page"><div class="nf-head"><h2>إلغاء الاشتراك</h2></div><div class="nf-banner" role="status">${ic("check")}<div><b>تم إلغاء اشتراكك من ${h(CAT(j.category))} ✓</b><br>رسائل الأمان واستعادة الحساب تصلك دائماً. سجّل الدخول لإدارة كل تفضيلات البريد.</div></div></div>`;
    } catch (e) { view.innerHTML = `<div class="wrap nf-page"><div class="nf-head"><h2>إلغاء الاشتراك</h2></div><div class="nf-banner warn">${ic("info")}<div>${h(e.message)}<br>يمكنك إدارة رسائلك من تفضيلات البريد بعد تسجيل الدخول.</div></div></div>`; }
  }
  /* #/reset?t=… — set a new password from the recovery email (works signed out) */
  function resetView() {
    const t = params().get("t");
    view.innerHTML = `<div class="wrap nf-page" style="max-width:440px;margin:auto;padding-top:24px"><div class="nf-head"><h2>كلمة مرور جديدة</h2></div>
      <form class="nf-card" id="rs-f" novalidate><p>اختر كلمة مرور من 8 أحرف على الأقل. سنسجّل خروجك من كل الأجهزة الأخرى.</p>
        <label class="u-db u-t-sm u-c-mu">كلمة المرور الجديدة<input type="password" id="rs-p" autocomplete="new-password" minlength="8" required class="u-mt4 u-mh46"></label>
        <label class="u-db u-t-sm u-c-mu u-mt10">تأكيد كلمة المرور<input type="password" id="rs-c" autocomplete="new-password" minlength="8" required class="u-mt4 u-mh46"></label>
        <div id="rs-e" role="alert" class="u-c-dg u-t-sm u-mh20 u-mt8"></div>
        <button class="btn block" id="rs-go" ${t ? "" : "disabled"}>حفظ كلمة المرور</button></form>
      ${t ? "" : `<div class="nf-banner warn">${ic("info")}<div>الرابط غير مكتمل. اطلب رابط استعادة جديداً من شاشة الدخول.</div></div>`}</div>`;
    const f = document.getElementById("rs-f"), err = document.getElementById("rs-e");
    f.onsubmit = async (e) => { e.preventDefault(); const pw = document.getElementById("rs-p").value, c = document.getElementById("rs-c").value;
      if (pw.length < 8) { err.textContent = "كلمة المرور قصيرة (8 أحرف على الأقل)"; return; } if (pw !== c) { err.textContent = "كلمتا المرور غير متطابقتين"; return; }
      const go = document.getElementById("rs-go"); go.disabled = true; err.textContent = "";
      try { if (has("resetPassword")) await N().resetPassword(t, pw); else await api("POST", "/api/auth/reset", { token: t, password: pw });
        view.innerHTML = `<div class="wrap nf-page" style="max-width:440px;margin:auto;padding-top:24px"><div class="nf-banner" role="status">${ic("check")}<div><b>تم تغيير كلمة المرور ✓</b><br>سجّل الدخول بكلمة المرور الجديدة.</div></div><button class="btn block" id="rs-in">تسجيل الدخول</button></div>`;
        document.getElementById("rs-in").onclick = () => { history.replaceState(null, "", "#/home"); if (typeof showAuth === "function") showAuth("login"); else location.reload(); };
      } catch (ex) { err.textContent = ex.message || "تعذّر تغيير كلمة المرور"; go.disabled = false; } };
  }

  /* ---------- wiring: routes, settings entry, badge ---------- */
  Views.notifications = () => center();
  MPRoutes.extend((a, b) => ({ notifsettings: () => settingsView(), nsettings: () => settingsView(), emailprefs: () => emailView(), "email-prefs": () => emailView(), unsubscribe: () => unsubscribeLanding(), reset: () => resetView() }));
  // signed-out landings: the auth screen owns the page, so render these two directly
  const outside = () => { const r = (location.hash.split("/")[1] || "").split("?")[0]; if (!document.body.classList.contains("ob")) return; if (r === "reset") resetView(); if (r === "unsubscribe") unsubscribeLanding(); };
  addEventListener("hashchange", outside); setTimeout(outside, 0);
  MPSettings.add(function () {
    const first = view.querySelector(".wrap .card"); if (!first || view.querySelector("#nf-set")) return;
    first.insertAdjacentHTML("beforebegin", `<a class="u-dflex u-aic u-g12 u-ci u-tdn card row" id="nf-set" href="#/notifsettings">${ic("bell")}<div class="grow"><b>الإشعارات والبريد</b><div class="muted">ما يصلك، أوقات الهدوء، الإشعارات على هذا الجهاز</div></div><span class="fwd" aria-hidden="true">←</span></a>`);
  });
  if (/^#\/settings/.test(location.hash) && window.__CHUNKS?.notify) route(); // the settings entry appears once the idle-loaded chunk lands
  window.MPChunks?.load("pwa").catch(() => { }); // phase 46: installable-app chunk rides on this idle chunk (0 B in core)
  window.MPNotifyUI = { center, settings: settingsView, email: emailView, toast: showToast, enablePush, version: "__APP_VERSION__" };
})();
