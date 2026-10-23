/* مجتمع بلس — «لقطات» v2.75: a clip can point at ONE of its author's own market listings or job postings (video/clips/links.js).
 * Part of the lazy "clips" chunk. Talks to the feed only through window.Clips; block marker: v275-links.
 *  • Viewers: a glass chip over the caption — bag/briefcase icon, the title, the price (product) or kind (job) — opens
 *    #/market/item/:id or #/job/:id. The link comes with the feed item (post.link); the viewer page fetches it lazily
 *    (GET /api/clips/:id/link). A sold-out listing or a closed job simply shows nothing (resolved server side).
 *  • Author: on their own clip a quiet «＋ اربط منتجاً أو وظيفة» text link (or «تعديل» on their chip) opens a sheet listing
 *    their active listings and open jobs (GET /api/clips/linkables) → PUT /api/clips/:id/link; «إزالة الربط» → DELETE.
 *    With nothing to link, the sheet points to #/market/new and #/jobs/new. Single tap / double-tap / long-press 2× on the
 *    video are untouched: the chip and links are ordinary buttons inside .short-info. */
/* v2.76 (block marker v276-links): three more kinds — a community the author runs, an upcoming event they organise, a
 * published course they wrote — and one action next to the chip for viewers: «اسأل البائع» (product → opens a chat with
 * the seller), «قدّم الآن» (job → the job page opens straight on the apply sheet), «ذكّرني» (event → toggles the event
 * reminder). Each chip / action tap is counted once a day per viewer (POST /api/clips/:id/link/click); the author sees the
 * count beside «تعديل». */
(function ClipsLinks() {
  const { ic, api, online } = Clips.util;
  /* === v275-links === */
  const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const say = (m) => { if (typeof toast === "function") toast(m); };
  const cache = new Map();
  const icoOf = (k) => ({ job: "brief", community: "users", event: "calendar", course: "book" })[k] || "bag";
  const lang = () => (document.documentElement.lang || "ar").startsWith("en") ? "en-US" : "ar-SA-u-nu-latn";
  const when = (at) => { const d = new Date(at); return isNaN(d) ? "" : d.toLocaleString(lang(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); };
  /* the small grey line under the title */
  function subOf(x) {
    if (x.kind === "product") return `<span data-noi18n dir="ltr">${esc(x.sub)}</span>`;
    if (x.kind === "event" && x.at) return `<span data-noi18n><bdi>${esc(when(x.at))}</bdi></span>`;
    if (x.kind === "community") return `<span><bdi dir="ltr" data-noi18n>${esc(Number(x.members || 0).toLocaleString("en-US"))}</bdi> ${T("عضواً")}</span>`;
    return `<span>${esc(T(x.sub))}</span>`;
  }
  const click = (p) => { if (online() && DB.me && p.author !== DB.me) api("POST", `/api/clips/${encodeURIComponent(p.id)}/link/click`).catch(() => {}); };
  /* the viewer's one action beside the chip */
  function actOf(p, link) {
    if (!online() || !DB.me || p.author === DB.me) return "";
    if (link.kind === "product") return `<button type="button" class="cl-lk-act" data-cl-lk-act="ask">${ic("comment", "xs")}<span>${T("اسأل البائع")}</span></button>`;
    if (link.kind === "job") return `<button type="button" class="cl-lk-act" data-cl-lk-act="apply">${ic("check", "xs")}<span>${T("قدّم الآن")}</span></button>`;
    if (link.kind === "event") return `<button type="button" class="cl-lk-act" data-cl-lk-act="remind" aria-pressed="${!!link.reminded}">${ic(link.reminded ? "bellOff" : "bell", "xs")}<span>${link.reminded ? T("سنذكّرك") : T("ذكّرني")}</span></button>`;
    return "";
  }
  async function act(sec, p, link, b) {
    const k = b.dataset.clLkAct; click(p);
    if (k === "apply") { try { sessionStorage.setItem("mp-auto-apply", link.id); } catch { /* private mode: the job page still opens */ } location.hash = link.href; return; }
    b.disabled = true;
    try {
      if (k === "ask") {
        const r = await api("POST", "/api/conversations", { user: p.author });
        const cid = r?.conversation?.id; if (!cid) throw new Error(T("تعذّر فتح المحادثة"));
        try { sessionStorage.setItem("mp-chat-draft:" + cid, T("مرحباً، أستفسر عن") + " «" + link.title + "»"); } catch { /* no draft then */ }
        location.hash = "#/chat/" + encodeURIComponent(cid); return;
      }
      if (k === "remind") {
        const on = !link.reminded;
        await api(on ? "PUT" : "DELETE", `/api/events/${encodeURIComponent(link.id)}/rsvp/reminder`);
        const nl = { ...link, reminded: on }; setLink(p, nl); paint(sec, p, nl);
        say(on ? T("سنذكّرك قبل الفعالية بساعة") : T("ألغينا التذكير"));
        sec.querySelector("[data-cl-lk-act]")?.focus({ preventScroll: true });
      }
    } catch (e) { say(e.message || T("تعذّر الإجراء")); b.disabled = false; }
  }
  function paint(sec, p, link) {
    const info = sec.querySelector(".short-info .cl-ov-snd") || sec.querySelector(".short-info p"); if (!info) return;
    sec.querySelectorAll(".cl-lk, .cl-lk-add").forEach((x) => x.remove());
    const mine = p.author === DB.me;
    if (link) {
      const box = document.createElement("div"); box.className = "cl-lk";
      box.innerHTML = `<a class="cl-lk-chip" href="${esc(link.href)}" data-cl-lk="${esc(link.kind)}"><span class="cl-lk-ic" aria-hidden="true">${ic(icoOf(link.kind), "xs")}</span><span class="cl-lk-t"><bdi>${esc(link.title)}</bdi><small>${subOf(link)}</small></span><span class="cl-lk-go" aria-hidden="true">${ic("arrowUp", "xs cl-lk-arr")}</span></a>`
        + actOf(p, link)
        + (mine && link.clicks != null ? `<span class="cl-lk-n" title="${T("نقرات المشاهدين على الرابط")}">${ic("chart", "xs")}<bdi dir="ltr" data-noi18n>${esc(Number(link.clicks).toLocaleString("en-US"))}</bdi><span>${T("نقرة")}</span></span>` : "")
        + (mine && online() ? `<button type="button" class="cl-lk-edit" data-cl-lk-edit><span>${T("تعديل")}</span></button>` : "");
      info.insertAdjacentElement("afterend", box);
      box.querySelector("[data-cl-lk-edit]")?.addEventListener("click", (e) => { e.stopPropagation(); picker(sec, p, e.currentTarget, link); });
      box.querySelector(".cl-lk-chip").addEventListener("click", () => click(p));
      box.querySelector("[data-cl-lk-act]")?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); act(sec, p, link, e.currentTarget); });
    } else if (mine && online()) {
      const b = document.createElement("button"); b.type = "button"; b.className = "cl-lk-add";
      b.innerHTML = `<span aria-hidden="true">＋</span> <span>${T("أضف رابطاً")}</span>`;
      b.addEventListener("click", (e) => { e.stopPropagation(); picker(sec, p, b, null); });
      (sec.querySelector(".cl-ser-add") || info).insertAdjacentElement("afterend", b);
    }
  }
  async function picker(sec, p, ret, cur) {
    let items = [];
    try { items = (await api("GET", "/api/clips/linkables")).items || []; } catch (e) { say(e.message); return; }
    const row = (x) => `<li><button type="button" class="cl-lk-opt" data-k="${esc(x.kind)}" data-id="${esc(x.id)}" aria-pressed="${!!cur && cur.kind === x.kind && cur.id === x.id}"><span class="cl-lk-ic" aria-hidden="true">${ic(icoOf(x.kind), "sm")}</span><span class="cl-lk-t"><bdi>${esc(x.title)}</bdi><small>${subOf(x)}</small></span></button></li>`;
    const GROUPS = [["product", "منتجاتي في السوق"], ["job", "إعلاناتي في الوظائف"], ["community", "مجتمعات أديرها"], ["event", "فعالياتي القادمة"], ["course", "دوراتي"]];
    const groups = GROUPS.map(([k, h]) => [h, items.filter((x) => x.kind === k)]).filter(([, l]) => l.length);
    const s = sheet(`<div class="cl-lk-sheet" role="dialog" aria-modal="true" aria-labelledby="cl-lk-h">
      <h3 id="cl-lk-h" tabindex="-1">${T("أضف رابطاً للفيديو")}</h3>
      <p class="muted">${T("منتج، وظيفة، مجتمع، فعالية أو دورة — يظهر للمشاهد شريط صغير يفتحها.")}</p>
      ${items.length ? groups.map(([h, l]) => `<h4>${T(h)}</h4><ul class="cl-lk-list">${l.map(row).join("")}</ul>`).join("")
        : `<p class="cl-lk-empty">${T("لا يوجد عندك بعد شيء يمكن ربطه.")}</p><div class="cl-lk-acts"><a class="btn ghost" href="#/market/new">${T("أضف منتجاً")}</a><a class="btn ghost" href="#/jobs/new">${T("انشر إعلاناً")}</a></div>`}
      <p class="cl-lk-err" role="alert"></p>
      <div class="cl-lk-acts">${cur ? `<button type="button" class="btn danger" data-cl-lk-rm>${T("إزالة الربط")}</button>` : ""}<button type="button" class="btn ghost" data-cl-lk-x>${T("إغلاق")}</button></div></div>`);
    const q = (x) => s.querySelector(x);
    s._onclose = () => { if (ret?.isConnected) ret.focus({ preventScroll: true }); };
    setTimeout(() => q("#cl-lk-h")?.focus(), 30);
    q("[data-cl-lk-x]").addEventListener("click", () => closeSheet());
    s.querySelectorAll(".cl-lk-opt").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { const r = await api("PUT", `/api/clips/${encodeURIComponent(p.id)}/link`, { kind: b.dataset.k, id: b.dataset.id }); setLink(p, r.link); closeSheet(); paint(sec, p, r.link); say(T("تم ربط المقطع")); }
      catch (e) { q(".cl-lk-err").textContent = e.message; b.disabled = false; }
    }));
    q("[data-cl-lk-rm]")?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try { await api("DELETE", `/api/clips/${encodeURIComponent(p.id)}/link`); setLink(p, null); closeSheet(); paint(sec, p, null); say(T("أُزيل الربط")); }
      catch (x) { q(".cl-lk-err").textContent = x.message; e.currentTarget.disabled = false; }
    });
  }
  function setLink(p, link) { p.link = link; cache.set(p.id, link); const P = (DB.posts || []).find((x) => x.id === p.id); if (P) P.link = link; }
  async function linkOf(p) {
    if (p.link !== undefined) return p.link;
    if (cache.has(p.id)) return cache.get(p.id);
    if (!online()) return null;
    try { const r = await api("GET", `/api/clips/${encodeURIComponent(p.id)}/link`); cache.set(p.id, r.link || null); return r.link || null; } catch { return null; }
  }
  Clips.onCurrent((sec, _i, p) => {
    if (!p || sec._clLk) return; sec._clLk = 1;
    linkOf(p).then((l) => { if (sec.isConnected) paint(sec, p, l); });
  });
})();
