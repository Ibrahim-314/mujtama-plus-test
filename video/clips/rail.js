/* مجتمع بلس — «لقطات» feature: side action rail (like, comments, save, share, support) (video/clips/rail.js).
 * Part of the lazy "clips" chunk (one hashed file at build time). Talks to the feed only through window.Clips
 * (hooks / api / util / ext, documented in video/clips/core.js); block marker kept: v271-rail. */
(function ClipsRail() {
  const { ic } = Clips.util;
  const clipCounts = Clips.api.counts;
  /* === v271-rail === */
  /* v2.71 action rail: turns each clip's .short-actions into a vertical rail on the inline-end side (core loop untouched).
   *  like     keeps data-react → the core quick-like (ui.js, capture phase; long-press = reaction picker) and the double-tap
 *           still drive it; the rail re-reads the state from a window capture listener (runs before the core one)
   *  comments dispatches CustomEvent "clips:comments" {detail:{post}} (cancelable) on document; a listener that opens its
   *           own sheet calls preventDefault() (or sets detail.handled = true), otherwise → #/post/<id>
   *  save     keeps data-save → the core saveMenu (collections picker, server sync); state from S.saved
   *  share    navigator.share → clipboard copy + toast
   *  tip      sheet (v2.74): MJT tip sent in place (presets/custom/note/anonymous, clip total + supporters), wallet link
   *           (#/mjt?tab=send&to=<handle>) kept, Pi tip shown «غير مفعّل بعد» (Pi stays visible, locked)
   * Counts are compact (1.2 ألف / 1.2K) via Intl, never an Arabic literal. */
  (function ClipsRail() {
    const lang = () => (typeof DB !== "undefined" && DB.settings && DB.settings.lang === "en" ? "en" : "ar");
    const compact = (n) => { n = Number(n) || 0; if (n <= 0) return ""; if (n < 1000) return String(n); try { return new Intl.NumberFormat(lang() === "en" ? "en" : "ar-u-nu-latn", { notation: "compact", maximumFractionDigits: 1 }).format(n); } catch { return String(n); } };
    const likes = (id) => S.reactionsOf(id).length || clipCounts.get(id)?.likes || 0;
    const comments = (id) => S.commentsOf(id).length || clipCounts.get(id)?.comments || 0;
    const liked = (id) => S.reactionsOf(id).some(r => r.user === DB.me);
    const saved = (id) => { try { return !!S.saved(id); } catch { return false; } };
    const svg = (d, fill) => `<svg class="ic cl-rail-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const BM = '<path d="M6 3h12v18l-6-4-6 4z"/>';
    const COIN = '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5"/>';
    const say = (m) => {
      if (typeof toast === "function") { try { toast(m); return; } catch { /* own toast below */ } }
      let t = document.getElementById("cl-rail-toast"); if (!t) { t = document.createElement("div"); t.id = "cl-rail-toast"; t.className = "cl-rail-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
      t.textContent = m; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2200);
    };
    // the count is drawn by CSS from data-n (not DOM text), so the visible label never contradicts the button's aria-label
    // (WCAG 2.5.3 / axe label-content-name-mismatch: "1.2K" is not part of "Like clip"); aria-hidden keeps it out of AT too
    const inner = (icon, n) => `<span class="cl-rail-ic">${icon}</span>${n == null ? "" : `<span class="cl-rail-n" data-noi18n aria-hidden="true" data-n="${esc(n)}"></span>`}`;
    const btn = (k, id, label, body, pressed, extra = "") => `<button type="button" class="cl-rail-btn cl-rail-${k}" data-cl-rail="${k}" data-cl-id="${esc(id)}" aria-label="${label}" title="${label}"${pressed == null ? "" : ` aria-pressed="${pressed}"`}${extra}>${body}</button>`;
    function paint(sec, p) {
      const box = sec && p && sec.querySelector(".short-actions"); if (!box || box.classList.contains("cl-rail")) return;
      const id = p.id;
      box.classList.add("cl-rail"); box.setAttribute("role", "group"); box.setAttribute("aria-label", "تفاعلات اللقطة");
      box.innerHTML = btn("like", id, "إعجاب باللقطة", inner(ic(liked(id) ? "heartF" : "heart"), compact(likes(id))), liked(id), ` data-react="${esc(id)}"`)
        + btn("comment", id, "تعليقات اللقطة", inner(ic("comment"), compact(comments(id))))
        + btn("save", id, "حفظ اللقطة في المحفوظات", inner(svg(BM, saved(id)), null), saved(id), ` data-save="${esc(id)}" aria-haspopup="dialog"`)
        + btn("share", id, "مشاركة رابط اللقطة", inner(ic("share"), null))
        + btn("tip", id, "دعم صانع اللقطة", inner(svg(COIN), null), null, ' aria-haspopup="dialog"');
    }
    function sync(sec) {
      const id = sec?.dataset.short; if (!id) return; const q = (k) => sec.querySelector(`[data-cl-rail="${k}"]`);
      const l = q("like"); if (l) { const on = liked(id); l.setAttribute("aria-pressed", String(on)); l.innerHTML = inner(ic(on ? "heartF" : "heart"), compact(likes(id))); }
      const c = q("comment"); if (c) c.innerHTML = inner(ic("comment"), compact(comments(id)));
      const s = q("save"); if (s) { const on = saved(id); s.setAttribute("aria-pressed", String(on)); s.innerHTML = inner(svg(BM, on), null); }
    }
    let sheetEl = null, opener = null;
    const closeSheet = (back = true) => { if (!sheetEl) return; sheetEl.remove(); sheetEl = null; if (back && opener?.isConnected) opener.focus({ preventScroll: true }); opener = null; };
    /* v2.74 «إكرامية مجتمع كوين» in place: the sheet sends an MJT tip to the clip's author without leaving the clip
     * (POST /api/mjt/posts/:id/tips — same guards and limits as a member transfer, idempotent per open sheet + amount).
     * Shows the clip's total + top supporters, the viewer's balance, preset chips + a custom amount, an optional short
     * note and «دون إظهار اسمي». The wallet link (#/mjt send page) and the locked Pi option stay. Own clip → summary only. */
    const PRESETS = [5, 10, 25, 50];
    const rid = () => { try { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40); } catch { return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } };
    const api = (m, u, b) => (typeof Remote !== "undefined" && Remote.api ? Remote.api(m, u, b) : Promise.reject(new Error("تعذر الاتصال بالخادم")));
    const AMT_RE = /^\d{1,6}(\.\d{1,7})?$/;
    const latin = (v) => String(v || "").trim().replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[٫,]/g, ".");
    const ava = (u) => u?.avatar ? `<img class="cl-tip-av" src="${esc(u.avatar)}" alt="" loading="lazy" decoding="async">` : `<span class="cl-tip-av cl-tip-av-i" aria-hidden="true">${esc(((u?.name || u?.handle || "?").trim()[0] || "?"))}</span>`;
    function sumHTML(sm) {
      if (!sm) return `<span class="cl-tip-muted">…</span>`;
      if (!sm.count) return `<span class="cl-tip-muted">كن أول من يدعم هذه اللقطة</span>`;
      const faces = sm.top.slice(0, 4).map((t) => (t.anon ? `<span class="cl-tip-av cl-tip-av-i" aria-hidden="true">${lang() === "en" ? "?" : "؟"}</span>` : ava(t.user))).join("");
      return `<span class="cl-tip-faces">${faces}</span><span><b class="cl-tip-num" data-noi18n>${esc(String(sm.total))} MJT</b> <span>من</span> <b class="cl-tip-num" data-noi18n>${esc(String(sm.supporters))}</b> <span>${sm.supporters === 1 ? "داعم" : "داعمين"}</span></span>`;
    }
    function tipSheet(p, from) {
      closeSheet(false); opener = from; const u = S.user(p.author) || {}; const mine = p.author === DB.me;
      let amount = "10", key = rid(), busy = false, me = null, sm = null;
      sheetEl = document.createElement("div"); sheetEl.className = "cl-rail-sheet";
      sheetEl.innerHTML = `<div class="cl-rail-scrim" data-cl-close></div><div class="cl-rail-panel cl-tip" role="dialog" aria-modal="true" aria-labelledby="cl-rail-st" aria-describedby="cl-tip-who">`
        + `<div class="cl-tip-head">${ava(u)}<div><h3 class="cl-rail-st" id="cl-rail-st">${mine ? "إكراميات لقطتك" : "دعم صانع اللقطة"}</h3><p class="cl-tip-who" id="cl-tip-who"><bdi>${esc(u.name || "")}</bdi> <span class="cl-tip-muted" dir="ltr">@${esc(u.handle || "")}</span></p></div></div>`
        + `<div class="cl-tip-sum" data-cl-sum aria-live="polite">${sumHTML(null)}</div>`
        + (mine ? "" : `<div class="cl-tip-form" data-cl-form>`
          + `<div class="cl-tip-amts" role="group" aria-label="اختر مبلغ الإكرامية">${PRESETS.map((v) => `<button type="button" class="cl-tip-chip" data-cl-amt="${v}" aria-pressed="${String(v) === amount}"><b data-noi18n>${v}</b> <small data-noi18n>MJT</small></button>`).join("")}</div>`
          + `<label class="cl-tip-field"><span>مبلغ آخر</span><input type="text" inputmode="decimal" autocomplete="off" class="cl-tip-in" data-cl-custom placeholder="مثلاً 15" maxlength="14" dir="ltr"></label>`
          + `<label class="cl-tip-field"><span>رسالة قصيرة (اختياري)</span><input type="text" class="cl-tip-in" data-cl-note maxlength="140" autocomplete="off"></label>`
          + `<label class="cl-tip-check"><input type="checkbox" data-cl-anon> <span>أرسلها دون إظهار اسمي</span></label>`
          + `<p class="cl-tip-bal" data-cl-bal><span>رصيدك</span> <b class="cl-tip-num" data-noi18n>…</b></p>`
          + `<p class="cl-tip-err" data-cl-err role="alert"></p>`
          + `<button type="button" class="cl-tip-send" data-cl-send><span>أرسل الإكرامية</span> <b data-noi18n data-cl-sendamt>10 MJT</b></button></div>`)
        + `<a class="cl-rail-opt" data-cl-mjt href="#/mjt?tab=send&amp;to=${encodeURIComponent(u.handle || "")}">${svg(COIN)}<span>${mine ? "فتح محفظة مجتمع كوين" : "إكرامية مجتمع كوين (MJT) من المحفظة"}</span></a>`
        + `<button type="button" class="cl-rail-opt" data-cl-pi disabled aria-disabled="true">${svg(COIN)}<span>إكرامية Pi — غير مفعّل بعد</span></button>`
        + `<button type="button" class="cl-rail-close" data-cl-close>إغلاق نافذة الدعم</button></div>`;
      document.body.appendChild(sheetEl);
      const el = sheetEl, q = (s) => el.querySelector(s);
      const err = (m) => { const e = q("[data-cl-err]"); if (e) e.textContent = m || ""; };
      const cur = () => { const c = q("[data-cl-custom]"); const v = latin(c && c.value); return v || amount; };
      const paintSend = () => {
        const b = q("[data-cl-send]"); if (!b) return; const v = cur(), ok = AMT_RE.test(v) && Number(v) > 0;
        q("[data-cl-sendamt]").textContent = (ok ? v : "—") + " MJT";
        const low = me && ok && Number(me.balance.mjt) < Number(v), blocked = me && me.send && !me.send.allowed;
        b.disabled = busy || !ok || !!low || !!blocked; b.setAttribute("aria-busy", String(busy));
        if (blocked) err(me.send.note || "الإكراميات غير متاحة لحسابك الآن"); else if (low) err("رصيدك من مجتمع كوين لا يكفي لهذا المبلغ"); else if (!busy) err("");
      };
      (q('[data-cl-amt][aria-pressed="true"]') || q("[data-cl-mjt]")).focus({ preventScroll: true });
      api("GET", "/api/mjt/posts/" + encodeURIComponent(p.id) + "/tips").then((r) => { sm = r; if (el.isConnected) q("[data-cl-sum]").innerHTML = sumHTML(sm); }).catch(() => { if (el.isConnected) q("[data-cl-sum]").innerHTML = `<span class="cl-tip-muted">تعذّر تحميل الإكراميات</span>`; });
      if (!mine) api("GET", "/api/mjt/me").then((r) => { me = r; if (!el.isConnected) return; q("[data-cl-bal] b").textContent = r.balance.mjt + " MJT"; paintSend(); }).catch(() => { if (el.isConnected) q("[data-cl-bal] b").textContent = "—"; });
      paintSend();
      async function send() {
        const v = cur(); if (busy || !AMT_RE.test(v) || !(Number(v) > 0)) return;
        busy = true; paintSend();
        try {
          const r = await api("POST", "/api/mjt/posts/" + encodeURIComponent(p.id) + "/tips", { ikey: key, amount: v, note: (q("[data-cl-note]").value || "").trim() || undefined, anon: !!q("[data-cl-anon]").checked });
          sm = r.summary; if (me) me.balance = r.balance;
          if (!el.isConnected) return;
          q("[data-cl-sum]").innerHTML = sumHTML(sm);
          q("[data-cl-form]").innerHTML = `<p class="cl-tip-done" role="status"><span class="cl-tip-done-ic" aria-hidden="true">${svg(COIN)}</span><span><b>وصلت إكراميتك</b><br><span>رصيدك الآن</span> <b class="cl-tip-num" data-noi18n>${esc(String(r.balance.mjt))} MJT</b></span></p>`;
          q(".cl-rail-close").focus({ preventScroll: true });
          coinBurst(from?.closest?.(".short"));
          say("شكراً لدعمك صانع اللقطة");
        } catch (e) {
          busy = false; key = rid(); // a refused tip moved nothing; a fresh key for the next try
          if (el.isConnected) { paintSend(); err(e && e.message ? e.message : "تعذّر إرسال الإكرامية"); }
          return;
        }
        busy = false;
      }
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-cl-close]")) { closeSheet(); return; }
        if (e.target.closest("[data-cl-mjt]")) { closeSheet(false); return; }
        const c = e.target.closest("[data-cl-amt]");
        if (c) { amount = c.dataset.clAmt; key = rid(); const ci = q("[data-cl-custom]"); if (ci) ci.value = ""; el.querySelectorAll("[data-cl-amt]").forEach((x) => x.setAttribute("aria-pressed", String(x === c))); paintSend(); return; }
        if (e.target.closest("[data-cl-send]")) send();
      });
      el.addEventListener("input", (e) => {
        if (!e.target.matches("[data-cl-custom]")) return; key = rid();
        const has = !!latin(e.target.value); el.querySelectorAll("[data-cl-amt]").forEach((x) => x.setAttribute("aria-pressed", String(!has && x.dataset.clAmt === amount)));
        paintSend();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
        if (e.key === "Enter" && e.target.matches("[data-cl-custom], [data-cl-note]")) { e.preventDefault(); send(); return; }
        if (e.key !== "Tab") return; const f = [...el.querySelectorAll("a[href],button:not([disabled]),input")]; if (!f.length) return; // focus stays in the dialog
        const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      });
    }
    /** a short rise of coins over the clip after a tip (a fade only under reduced motion) */
    function coinBurst(sec) {
      if (!sec) return; const box = document.createElement("div"); box.className = "cl-tip-burst"; box.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 6; i++) { const c = document.createElement("span"); c.style.setProperty("--i", String(i)); c.innerHTML = svg(COIN); box.appendChild(c); }
      sec.appendChild(box); setTimeout(() => box.remove(), 1400);
    }
    async function share(p) {
      const url = location.origin + location.pathname + "#/post/" + encodeURIComponent(p.id);
      if (navigator.share) { try { await navigator.share({ title: (p.text || "").slice(0, 80), url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
      try { await navigator.clipboard.writeText(url); say("تم نسخ رابط اللقطة"); } catch { say("تعذّر نسخ رابط اللقطة"); }
    }
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.(".shorts [data-cl-rail]"); if (!b) return;
      const sec = b.closest(".short"), p = S.post(b.dataset.clId); if (!sec || !p) return;
      const k = b.dataset.clRail;
      if (k === "like" || k === "save") return; // the core [data-react] / [data-save] handlers do the work (synced below)
      e.preventDefault();
      if (k === "comment") {
        const ev = new CustomEvent("clips:comments", { detail: { post: p }, cancelable: true });
        const open = document.dispatchEvent(ev); // synchronous: a listener had its chance in this same tick
        if (open && !ev.detail.handled) location.hash = "#/post/" + encodeURIComponent(p.id);
      } else if (k === "share") share(p);
      else if (k === "tip") tipSheet(p, b);
    });
    // core like/save run in capture/bubble handlers that stop propagation: re-read the state from a window capture listener
    const later = (sec) => { setTimeout(() => sync(sec), 0); setTimeout(() => sync(sec), 300); };
    addEventListener("click", (e) => {
      const b = e.target.closest?.(".shorts [data-cl-rail]"); if (b) { later(b.closest(".short")); return; }
      if (e.target.closest?.("#sheet [data-r], #sheet [data-c], #sheet [data-new]")) document.querySelectorAll(".shorts .short").forEach((sec) => { const r = sec.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) later(sec); }); // reaction picker / collections picker
    }, true);
    // core patchPost(pid) (after a like, a picked reaction or a save) finds no post-card .actions on this screen and fell back
    // to rerender(): the whole feed reloaded, jumped to the top and lost focus. On the clips screen, update the rail in place.
    if (typeof patchPost === "function" && !patchPost._clRail) {
      const core = patchPost;
      patchPost = function (pid) {
        const secs = document.body.classList.contains("shorts-mode") ? [...document.querySelectorAll(".shorts .short")].filter((s) => s.dataset.short === pid) : [];
        if (secs.length) { secs.forEach(sync); return; }
        return core.apply(this, arguments);
      };
      patchPost._clRail = true;
    }
    Clips.onSection(paint);
    Clips.onCurrent((sec) => sync(sec)); // counts may have changed while the clip was off screen
    Clips.onLeave(() => closeSheet(false));
    Clips.rail = { sync, compact }; // for teammates (e.g. the comments sheet refreshes the count after posting)
  })();
  /* === end v271-rail === */
})();
