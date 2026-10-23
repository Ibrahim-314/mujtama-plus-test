/* مجتمع بلس — «فيديوتك» v2.80: أدوات الصانع (video/clips/studio.js). Part of the lazy "clips" chunk; block marker: v280-studio.
 * Routes (the clips route owns #/clips/*; this file wraps Clips.view like creator.js / challenges.js):
 *   #/clips/drafts        «المسودات»: my saved Vidtik drafts (GET /api/clips/drafts) — open in the editor
 *                         (#/clips/create?draft=<id>) or delete (DELETE /api/clips/drafts/:id, with a confirm).
 *   #/clips/stats/<id>    «إحصاءات الفيديو» for the clip's author: views, completion, average watch, likes / comments /
 *                         shares / link taps, where viewers came from, and a 14-day views chart (GET /api/clips/:id/stats).
 * And on my own Vidtik profile (creator.js fires "vt:creator-self"): the drafts count and «أفضل وقت للنشر»
 * (GET /api/clips/insights/best-time — when my followers watch clips; hours converted to the device's clock).
 * Charts are plain CSS bars (no chart library); every number is in <bdi> and read out in one sentence for screen readers. */
(function VidtikStudio() {
  const { ic, api, online } = Clips.util;
  /* === v280-studio === */
  const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const say = (m) => { if (typeof toast === "function") toast(m); };
  const en = () => document.documentElement.lang === "en";
  const loc = () => (en() ? "en-GB" : "ar-SA-u-nu-latn");
  const num = (n) => (+n || 0).toLocaleString("en-US");
  const SRC = { foryou: "لك", following: "المتابَعون", profile: "ملفك في فيديوتك", tag: "صفحات الوسوم", sound: "صفحات الأصوات", challenge: "التحديات", link: "روابط المنتجات والوظائف", other: "أماكن أخرى" };
  const head = (title, back) => `<header class="clp-pg-head vs-head"><a class="clp-pg-back" href="${back}" aria-label="${T("رجوع")}">${ic("x")}</a><div class="clp-pg-t"><h1>${esc(title)}</h1></div></header>`;
  const fail = (e) => `<div class="empty" role="status"><p>${esc(e?.status === 404 ? T("غير موجود") : online() ? e?.message || T("تعذّر التحميل") : T("لا يوجد اتصال"))}</p><a class="btn ghost" href="#/clips">${T("رجوع إلى فيديوتك")}</a></div>`;
  const guest = () => window.MPSession?.state === "out";
  const guestView = () => { view.innerHTML = `<div class="wrap vs-pg"><div class="empty"><p>${T("سجّل الدخول لاستخدام أدوات فيديوتك")}</p><button type="button" class="btn" data-vs-login>${T("تسجيل الدخول")}</button></div></div>`; view.querySelector("[data-vs-login]").onclick = () => { if (typeof showAuth === "function") showAuth("login"); }; };
  const when = (iso, o = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) => { try { return new Date(iso).toLocaleString(loc(), o); } catch { return ""; } };

  /* ---------- #/clips/drafts ---------- */
  async function drafts() {
    document.body.classList.remove("shorts-mode");
    if (guest()) return guestView();
    const token = {}; view._vs = token;
    view.innerHTML = `<div class="wrap vs-pg" aria-busy="true">${head(T("المسودات"), "#/clips/@me")}<div class="vt-pf-skel"><span></span><span></span><span></span></div></div>`;
    fixBack();
    let r; try { r = await api("GET", "/api/clips/drafts"); } catch (e) { if (view._vs === token) view.innerHTML = `<div class="wrap vs-pg">${head(T("المسودات"), "#/clips")}${fail(e)}</div>`; return; }
    if (view._vs !== token) return;
    const items = r.items || [];
    const card = (d) => {
      const cap = String(d.caption || "").replace(/\s+/g, " ").trim();
      const meta = [d.publishAt ? `${ic("clock", "xs")}<span>${T("موعد مقترح")}: <bdi>${esc(when(d.publishAt))}</bdi></span>` : "", d.link ? `${ic("tag", "xs")}<span><bdi data-noi18n>${esc(d.link.title)}</bdi></span>` : ""].filter(Boolean).map((x) => `<span class="vs-chip">${x}</span>`).join("");
      return `<li class="vs-d" data-id="${esc(d.id)}">
        <a class="vs-d-open" href="#/clips/create?draft=${encodeURIComponent(d.id)}">
          <span class="vs-d-th">${d.media?.poster ? `<img src="${esc(d.media.poster)}" alt="" loading="lazy" decoding="async" width="72" height="128">` : `<span aria-hidden="true">${ic("play")}</span>`}</span>
          <span class="vs-d-b"><span class="vs-d-cap">${cap ? `<bdi data-noi18n>${esc(cap.slice(0, 90))}</bdi>` : `<span class="muted">${T("بدون وصف")}</span>`}</span>
            <span class="vs-d-meta">${d.missing ? `<span class="vs-chip vs-bad">${ic("alert", "xs")}<span>${T("الفيديو غير متاح")}</span></span>` : meta}</span>
            <span class="vs-d-at muted">${T("آخر تعديل")} <bdi>${esc(when(d.updatedAt))}</bdi></span></span>
        </a>
        <button type="button" class="vs-del" data-vs-del="${esc(d.id)}" aria-label="${T("حذف المسودة")}">${ic("trash", "sm")}</button>
      </li>`;
    };
    view.innerHTML = `<div class="wrap vs-pg">${head(T("المسودات"), "#/clips/@me")}
      <p class="vs-sub muted">${T("مقاطع رفعتها ولم تنشرها بعد. افتح أي مسودة لتكملها وتنشرها أو تجدولها.")} <bdi>${num(items.length)}/${num(r.max || 20)}</bdi></p>
      ${items.length ? `<ul class="vs-list">${items.map(card).join("")}</ul>` : `<div class="empty" role="status"><p>${T("لا توجد مسودات")}</p><a class="btn" href="#/clips/create">${ic("plus", "sm")} ${T("فيديو جديد")}</a></div>`}
    </div>`;
    fixBack();
    view.querySelector(".vs-list")?.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-vs-del]"); if (!b) return;
      if (!confirm(T("حذف هذه المسودة؟ لا يمكن التراجع."))) return;
      b.disabled = true;
      try { await api("DELETE", `/api/clips/drafts/${encodeURIComponent(b.dataset.vsDel)}`); say(T("حُذفت المسودة")); if (view._vs === token) drafts(); }
      catch (x) { b.disabled = false; say(x?.message || T("تعذّر الإجراء")); }
    });
  }
  // «رجوع» goes to MY Vidtik profile (the handle is only known on the client)
  function fixBack() {
    const a = view.querySelector('.vs-head a[href="#/clips/@me"]'); if (!a) return;
    let h = ""; try { h = (window.DB?.users || []).find((x) => x.id === window.DB?.me)?.handle || ""; } catch { /* none */ }
    a.setAttribute("href", h ? "#/clips/@" + encodeURIComponent(h) : "#/clips");
  }

  /* ---------- #/clips/stats/<id> ---------- */
  async function stats(id) {
    document.body.classList.remove("shorts-mode");
    if (guest()) return guestView();
    const token = {}; view._vs = token;
    view.innerHTML = `<div class="wrap vs-pg" aria-busy="true">${head(T("إحصاءات الفيديو"), "#/clips/@me")}<div class="vt-pf-skel"><span></span><span></span><span></span></div></div>`;
    fixBack();
    let r; try { r = await api("GET", `/api/clips/${encodeURIComponent(id)}/stats`); } catch (e) { if (view._vs === token) { view.innerHTML = `<div class="wrap vs-pg">${head(T("إحصاءات الفيديو"), "#/clips")}${fail(e)}</div>`; } return; }
    if (view._vs !== token) return;
    const c = r.clip || {}, cap = String(c.text || "").replace(/\s+/g, " ").trim();
    const kpi = (v, l, ic2) => `<li class="vs-k">${ic(ic2, "sm")}<b><bdi>${v}</bdi></b><span>${l}</span></li>`;
    const max = Math.max(1, ...(r.daily || []).map((d) => d.n));
    const days = (r.daily || []).map((d) => `<li class="vs-bar" data-v="${Math.round((d.n / max) * 100)}"><i></i><span class="vs-sr">${esc(when(d.day + "T12:00:00Z", { day: "numeric", month: "short" }))}: ${num(d.n)}</span></li>`).join("");
    const firstDay = r.daily?.[0]?.day, lastDay = r.daily?.[r.daily.length - 1]?.day;
    const total14 = (r.daily || []).reduce((a, d) => a + d.n, 0);
    const srcs = (r.sources || []).map((s) => `<li class="vs-src"><span class="vs-src-l">${esc(T(SRC[s.src] || SRC.other))}</span><span class="vs-src-bar" data-v="${s.pct}"><i></i></span><b><bdi>${s.pct}%</bdi></b></li>`).join("");
    view.innerHTML = `<div class="wrap vs-pg">${head(T("إحصاءات الفيديو"), "#/clips/@me")}
      <a class="vs-clip" href="#/clips?start=${encodeURIComponent(c.id)}">${c.cover ? `<img src="${esc(c.cover)}" alt="" width="54" height="96" loading="lazy" decoding="async">` : `<span class="vs-clip-ph" aria-hidden="true">${ic("play")}</span>`}
        <span><span class="vs-clip-cap">${cap ? `<bdi data-noi18n>${esc(cap.slice(0, 100))}</bdi>` : T("فيديو")}</span><span class="muted">${c.status === "scheduled" ? T("مجدول") + " · " + esc(when(c.publishAt)) : T("نُشر") + " " + esc(when(c.createdAt, { day: "numeric", month: "short", year: "numeric" }))}</span></span></a>
      <ul class="vs-kpis">
        ${kpi(num(r.views), T("مشاهِد"), "eye")}
        ${kpi(r.completionPct + "%", T("أكملوه"), "check")}
        ${kpi((r.avgWatchSec || 0).toLocaleString("en-US", { maximumFractionDigits: 1 }) + (en() ? "s" : " ث"), T("متوسط المشاهدة"), "clock")}
        ${kpi(num(r.likes), T("إعجاب"), "heart")}
        ${kpi(num(r.comments), T("تعليق"), "comment")}
        ${kpi(num(r.shares), T("مشاركة"), "share")}
        ${kpi(num(r.linkClicks), T("نقرة على الرابط"), "tag")}
      </ul>
      <section class="vs-card" aria-labelledby="vs-h-d"><h2 class="vs-h" id="vs-h-d">${T("المشاهدات آخر 14 يوماً")}</h2>
        ${total14 ? `<ol class="vs-bars" aria-hidden="false">${days}</ol><p class="vs-axis muted" aria-hidden="true"><bdi>${esc(when(firstDay + "T12:00:00Z", { day: "numeric", month: "short" }))}</bdi><bdi>${esc(when(lastDay + "T12:00:00Z", { day: "numeric", month: "short" }))}</bdi></p>` : `<p class="muted">${T("لا مشاهدات جديدة في هذه الفترة")}</p>`}
      </section>
      <section class="vs-card" aria-labelledby="vs-h-s"><h2 class="vs-h" id="vs-h-s">${T("من أين جاء المشاهدون")}</h2>
        ${srcs ? `<ul class="vs-srcs">${srcs}</ul>` : `<p class="muted">${T("ستظهر المصادر بعد أول مشاهدات")}</p>`}
      </section>
      <p class="vs-note muted">${T("المشاهِد = شخص مختلف شاهد الفيديو؛ مشاهداتك أنت لا تُحتسب. «أكملوه» = شاهدوا 90% منه على الأقل.")}</p>
    </div>`;
    view.querySelectorAll(".vs-bar[data-v]").forEach((el) => el.style.setProperty("--h", Math.max(+el.dataset.v ? 4 : 0, +el.dataset.v) + "%")); // set as properties, never interpolated into HTML
    view.querySelectorAll(".vs-src-bar[data-v]").forEach((el) => el.style.setProperty("--w", Math.max(2, +el.dataset.v) + "%"));
    fixBack();
  }

  /* ---------- my Vidtik profile: drafts count + best time ---------- */
  addEventListener("vt:creator-self", async (e) => {
    const root = e.detail?.root; if (!root || !online()) return;
    api("GET", "/api/clips/drafts").then((r) => { const b = root.querySelector("[data-vt-drafts]"); const n = (r.items || []).length; if (b && n) { b.textContent = num(n); b.hidden = false; } }).catch(() => { });
    let r; try { r = await api("GET", "/api/clips/insights/best-time"); } catch { return; }
    const box = root.querySelector("[data-vt-best]"); if (!box || !root.isConnected) return;
    const local = (h) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return d.toLocaleTimeString(loc(), { hour: "numeric" }); };
    box.innerHTML = r.enough
      ? `${ic("clock", "sm")}<span><b>${T("أفضل وقت للنشر")}</b><span class="vs-best-h">${r.top.map((h) => `<bdi>${esc(local(h))}</bdi>`).join(" · ")}</span><small class="muted">${T("حين يشاهد متابعوك أكثر، آخر 30 يوماً")}</small></span>`
      : `${ic("clock", "sm")}<span><b>${T("أفضل وقت للنشر")}</b><small class="muted">${T("يظهر بعد أن يشاهد متابعوك مقاطع أكثر")}</small></span>`;
    box.hidden = false;
  });

  const base = Clips.view;
  Clips.view = function () {
    if (/^#\/clips\/drafts(\?|$)/.test(location.hash)) return drafts();
    const m = /^#\/clips\/stats\/([^?/]+)/.exec(location.hash);
    if (m) { let id = m[1]; try { id = decodeURIComponent(id); } catch { /* raw */ } return stats(id); }
    return base.apply(this, arguments);
  };
  addEventListener("hashchange", () => { if (view._vs && !/^#\/clips\/(drafts|stats\/)/.test(location.hash)) view._vs = null; });
  /* === /v280-studio === */
})();
