/* =====================================================================
 * مجتمع بلس — User protection UI (Track 7, phase 33). Needs protection-core.js (window.MPProtectionCore).
 *  • 🛡 one-tap safety button on every post card → safety sheet (mute author/word with durations, block incl.
 *    linked accounts, report, who can reply, protection mode, help)
 *  • simplified 3-step report screen (replaces reportFlow when online)
 *  • hidden replies on the post page (collapsed behind a tap; the author can hide / show) + reply-audience notice
 *  • #/protection (protection mode, blocks, mutes) · #/help[/slug] (help center + support resources)
 *    · #/policies[/slug] (versioned content policies; admins draft & publish)
 *  • timed feed mutes collapse a post behind «عرض»; abuse-wave suggestion banner; policy-update toast
 * Offline / demo mode keeps the original local behaviour.
 * ===================================================================== */
(function ProtectionLayer() {
  const Core = window.MPProtectionCore; if (!Core || window.MPProtection) return; // needs protection-core.js; load once
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const enc = encodeURIComponent;
  const fmt = (iso) => { try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; } };
  const err = (e) => toast(e?.message || "تعذر إتمام العملية");
  const ST = { rules: [], reveal: new Set(), mode: null, modeAt: 0, help: null };

  const CSS = `
.pt-shield{background:none;border:0;color:var(--muted);padding:0;width:44px;height:44px;flex:none;align-self:flex-start;margin-inline-end:-8px;border-radius:12px;display:inline-grid;place-items:center;cursor:pointer}
.pt-shield:hover,.pt-shield:focus-visible{color:var(--accent-ink);background:var(--accent2)}
.pt-sheet h4{margin:0 0 4px}.pt-sub{color:var(--muted);font-size:13px;margin:0 0 10px}
.pt-menu{display:grid;gap:6px}.pt-menu button,.pt-menu a{display:flex;align-items:center;gap:10px;text-align:start;padding:12px;border-radius:14px;background:var(--bg-2);border:1px solid var(--line);color:var(--text);font:inherit;font-weight:650;cursor:pointer;text-decoration:none}
.pt-menu button small,.pt-menu a small{display:block;color:var(--muted);font-weight:500;font-size:12.5px}
.pt-menu .danger{color:var(--danger)}.pt-menu button:focus-visible,.pt-menu a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pt-steps{display:flex;gap:6px;margin:4px 0 12px}.pt-steps i{flex:1;height:4px;border-radius:4px;background:var(--line)}.pt-steps i.on{background:var(--accent)}
.pt-opts{display:grid;gap:6px;border:0;padding:0;margin:0}.pt-opts label{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:14px;cursor:pointer}
.pt-opts label:has(input:checked){border-color:var(--accent);background:var(--accent2)}.pt-opts label>span{flex:1;min-width:0}
.pt-opts input,.pt-sheet input[type=checkbox],.pt-sheet input[type=radio],#pt-auto,#pt-bl{width:auto;min-width:0;flex:0 0 auto;margin:3px 0 0;padding:0;box-shadow:none;accent-color:var(--accent)}
.pt-opts small{display:block;color:var(--muted)}.pt-row{display:flex;gap:8px;margin-top:12px}.pt-row .btn{flex:1}
.pt-note{border-radius:14px;padding:10px 12px;background:var(--bg-2);border:1px solid var(--line);font-size:13.5px;margin:10px 0}
.pt-note.warn{border-color:var(--warn)}.pt-res{display:grid;gap:8px}.pt-res .r{display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:14px}
.pt-res .r .grow{min-width:0}.pt-res .r small{display:block;color:var(--muted)}.pt-tel{font-weight:800;font-size:17px;color:var(--accent-ink);text-decoration:none;direction:ltr}
.pt-hidden>*:not(.pt-reveal){display:none}.pt-hidden.pt-open>*{display:revert}.pt-reveal{display:block;width:100%;text-align:start;background:var(--bg-2);border:1px dashed var(--line-2);color:var(--muted);padding:8px 10px;border-radius:12px;cursor:pointer;font:inherit}
.pt-mutedcard{display:flex;gap:10px;align-items:center;color:var(--muted)}.pt-mutedcard .grow{min-width:0}
.pt-banner{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid var(--warn);background:var(--card);border-radius:16px;padding:12px;margin:10px 0}
.pt-banner p{margin:0;flex:1 1 220px}.pt-audience{font-size:13px;color:var(--muted);padding:6px 12px}
.pt-art p,.pt-art li{line-height:1.8}.pt-pol{white-space:normal;line-height:1.9}.pt-pol h3{margin:14px 0 6px}
.pt-field{display:grid;gap:4px;margin:8px 0}.pt-field input,.pt-field select,.pt-field textarea{width:100%}
.pt-list .row{padding:8px 0;border-bottom:1px solid var(--line)}`;
  (function inject() { if (document.getElementById("pt-css")) return; const s = document.createElement("style"); s.id = "pt-css"; s.textContent = CSS; document.head.appendChild(s); })();

  /** open a sheet as an accessible dialog and focus its first control */
  function dialog(html, label) {
    const s = sheet(`<div class="pt-sheet">${html}</div>`); const p = s.querySelector(".panel");
    if (p) { p.setAttribute("role", "dialog"); p.setAttribute("aria-modal", "true"); p.setAttribute("aria-label", label); }
    requestAnimationFrame(() => (s.querySelector("input:checked, button, a, input, textarea") || p)?.focus?.());
    return s;
  }
  const authorOf = (target, kind) => kind === "post" ? S.post(target)?.author : kind === "comment" ? (DB.comments || []).find(c => c.id === target)?.author : kind === "user" ? target : null;

  /* =================== mute rules (client copy for feed collapse) =================== */
  async function loadRules() { if (!online() || (window.MPSession && !MPSession.signedIn())) return; try { ST.rules = (await api("GET", "/api/protection/mutes")).mutes.filter(r => !r.legacy); } catch { } }
  async function addMute(body) { const r = await api("POST", "/api/protection/mutes", body); await loadRules(); return r; }

  function muteSheet(userId) {
    const u = S.user(userId) || { name: "" };
    const s = dialog(`<h4>كتم ${h(u.name)}</h4><p class="pt-sub">لن ترى منشوراته وإشعاراته، ولن يعلم بذلك.</p>
      <fieldset class="pt-opts" role="radiogroup" aria-label="مدة الكتم">${Object.entries(Core.DURATION_LABELS).map(([k, l], i) => `<label><input type="radio" name="pt-d" value="${k}" ${i === 1 ? "checked" : ""}> ${l}</label>`).join("")}</fieldset>
      <div class="pt-row"><button class="btn" id="pt-go">كتم</button><button class="btn ghost" id="pt-x">إلغاء</button></div>`, "كتم الحساب");
    s.querySelector("#pt-x").onclick = closeSheet;
    s.querySelector("#pt-go").onclick = async () => {
      const d = s.querySelector("input[name=pt-d]:checked").value;
      try { await addMute({ kind: "user", value: userId, duration: d, scope: "all" }); if (d === "forever" && !DB.muted.users.includes(userId)) { DB.muted.users.push(userId); save(); } closeSheet(); toast(`تم الكتم (${Core.DURATION_LABELS[d]})`); rerender(); } catch (e) { err(e); }
    };
  }
  function muteWordSheet(seed = "") {
    const s = dialog(`<h4>كتم كلمة أو وسم</h4><p class="pt-sub">نطابق الأشكال العربية تلقائياً (إساءة = اساءه) ونتجاهل التشكيل.</p>
      <label class="pt-field"><span>الكلمة أو #الوسم</span><input id="pt-w" maxlength="60" value="${h(seed)}" autocomplete="off"></label>
      <label class="pt-field"><span>أين؟</span><select id="pt-sc"><option value="all">في كل مكان</option><option value="feed">الخلاصة فقط</option><option value="notifications">الإشعارات فقط</option><option value="replies">الردود فقط</option></select></label>
      <label class="pt-field"><span>المدة</span><select id="pt-du">${Object.entries(Core.DURATION_LABELS).map(([k, l]) => `<option value="${k}" ${k === "forever" ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="u-dflex u-g8 u-aic"><input type="checkbox" id="pt-ww"> الكلمة كاملة فقط</label>
      <div class="pt-row"><button class="btn" id="pt-go">كتم</button><button class="btn ghost" id="pt-x">إلغاء</button></div>`, "كتم كلمة");
    s.querySelector("#pt-x").onclick = closeSheet;
    s.querySelector("#pt-go").onclick = async () => {
      const v = s.querySelector("#pt-w").value.trim(); if (!v) return s.querySelector("#pt-w").focus();
      try { await addMute({ kind: v.startsWith("#") ? "hashtag" : "word", value: v, scope: s.querySelector("#pt-sc").value, duration: s.querySelector("#pt-du").value, wholeWord: s.querySelector("#pt-ww").checked }); closeSheet(); toast("تم كتم «" + v + "»"); rerender(); } catch (e) { err(e); }
    };
  }

  /* =================== block with linked accounts =================== */
  async function blockSheet(userId, after) {
    const u = S.user(userId) || { name: "" };
    let pv = { linked: 0, orgs: [] }; try { pv = await api("GET", `/api/protection/blocks/${userId}/preview`); } catch { }
    const s = dialog(`<h4>حظر ${h(u.name)}؟</h4><p class="pt-sub">لن يتمكن من رؤية ملفك أو التعليق أو الإشارة إليك أو مراسلتك، وتُلغى المتابعة بينكما.</p>
      ${pv.linked ? `<label class="u-dflex u-g8 u-ais pt-note"><input type="checkbox" id="pt-ln" checked><span>حظر الحسابات المرتبطة به أيضاً (${pv.linked})${pv.orgs.length ? `: ${pv.orgs.map(o => h(o.name)).join("، ")}` : ""}${pv.hidden ? `<small class="u-db muted">${pv.hidden} منها لا نعرض هويتها حفاظاً على الخصوصية.</small>` : ""}</span></label>` : ""}
      <div class="pt-row"><button class="u-bg-dg btn" id="pt-go">حظر</button><button class="btn ghost" id="pt-x">إلغاء</button></div>`, "حظر الحساب");
    s.querySelector("#pt-x").onclick = closeSheet;
    s.querySelector("#pt-go").onclick = async () => {
      try { const r = await api("PUT", `/api/protection/blocks/${userId}`, { linked: s.querySelector("#pt-ln")?.checked !== false }); Cmd.block(userId); closeSheet(); toast(r.linkedBlocked ? `تم الحظر مع ${r.linkedBlocked} حساب مرتبط` : "تم الحظر"); (after || rerender)(); } catch (e) { err(e); }
    };
  }

  /* =================== protection mode =================== */
  async function getMode(force) { if (!online() || (window.MPSession && !MPSession.signedIn())) return null; if (!force && ST.mode && Date.now() - ST.modeAt < 30e3) return ST.mode; try { ST.mode = (await api("GET", "/api/protection/mode")).mode; ST.modeAt = Date.now(); } catch { } return ST.mode; }
  async function setMode(body) { ST.mode = (await api("PUT", "/api/protection/mode", body)).mode; ST.modeAt = Date.now(); return ST.mode; }
  function modeSheet() {
    const m = ST.mode || { active: false, limits: { replies: true, dms: true, mentions: true } };
    const s = dialog(`<h4>${ic("shield", "sm")} وضع الحماية</h4>
      <p class="pt-sub">${m.active ? `مفعّل حتى ${h(fmt(m.endsAt))}` : "يحدّ مؤقتاً من الردود والرسائل والإشارات لتصلك فقط ممن تتابعهم ومتابعيك القدامى."}</p>
      ${m.active ? "" : `<label class="pt-field"><span>المدة</span><select id="pt-hr">${Core.MODE_HOURS.map(x => `<option value="${x}" ${x === 24 ? "selected" : ""}>${x < 24 ? x + " ساعة" : x / 24 + " يوم"}</option>`).join("")}</select></label>`}
      <fieldset class="pt-opts" aria-label="ما الذي يُقيَّد"><legend class="pt-sub">ما الذي يُقيَّد</legend>${[["replies", "الردود على منشوراتك"], ["dms", "الرسائل الخاصة"], ["mentions", "الإشارات إليك"]].map(([k, l]) => `<label><input type="checkbox" data-lim="${k}" ${m.limits?.[k] !== false ? "checked" : ""}> ${l}</label>`).join("")}</fieldset>
      <div class="pt-row"><button class="btn" id="pt-go">${m.active ? "إيقاف وضع الحماية" : "تشغيل"}</button><button class="btn ghost" id="pt-x">إغلاق</button></div>
      <a href="#/help/protection-mode" class="u-db u-mt10 muted">كيف يعمل وضع الحماية؟</a>`, "وضع الحماية");
    s.querySelector("#pt-x").onclick = closeSheet;
    s.querySelector("#pt-go").onclick = async () => {
      const limits = Object.fromEntries([...s.querySelectorAll("[data-lim]")].map(x => [x.dataset.lim, x.checked]));
      try { const r = await setMode(m.active ? { active: false } : { active: true, hours: +s.querySelector("#pt-hr").value, limits }); closeSheet(); toast(r.active ? "تم تشغيل وضع الحماية" : "أُوقف وضع الحماية"); removeBanner(); rerender(); } catch (e) { err(e); }
    };
  }

  /* =================== one-tap safety sheet =================== */
  async function safetySheet(pid) {
    if (!online()) return moreMenu(pid);
    dialog(`<h4>${ic("shield", "sm")} أدوات الأمان</h4><div class="skel" style="height:120px"></div>`, "أدوات الأمان");
    let d; try { d = await api("GET", `/api/posts/${pid}/safety`); } catch (e) { closeSheet(); return err(e); }
    ST.mode = d.protection; ST.modeAt = Date.now();
    const a = d.author || {};
    const item = (k, icon, label, sub, cls = "") => `<button data-pt="${k}" class="${cls}">${ic(icon, "sm")}<span>${label}${sub ? `<small>${sub}</small>` : ""}</span></button>`;
    const protect = item("mode", "shield", d.protection.active ? "وضع الحماية مفعّل" : "تشغيل وضع الحماية", d.protection.active ? "حتى " + h(fmt(d.protection.endsAt)) : "قيّد الردود والرسائل مؤقتاً");
    const help = `<a href="#/help" data-pt="help">${ic("sparkle", "sm")}<span>مركز المساعدة والدعم<small>موارد دعم نفسي وأرقام موثوقة</small></span></a>`;
    const body = d.isAuthor
      ? `<p class="pt-sub">من يمكنه الرد على منشورك؟</p><fieldset class="pt-opts" role="radiogroup" aria-label="من يمكنه الرد">${Core.AUDIENCES.filter(x => x !== "community" || d.hasCommunity).map(x => `<label><input type="radio" name="pt-aud" value="${x}" ${d.audience === x ? "checked" : ""}> ${Core.AUDIENCE_LABELS[x]}</label>`).join("")}</fieldset>
         <div class="u-mt10 pt-menu">${item("hide", "eye", "إخفاء الردود", d.hidden.length ? `${d.hidden.length} رد مخفي — افتح المنشور للإدارة` : "افتح المنشور واضغط «إخفاء» بجانب أي رد")}${protect}${help}</div>`
      : `<div class="pt-menu">
          ${item("mute", "volumeX", `كتم ${h(a.name)}`, d.authorMuted.length ? "مكتوم حالياً" : "ساعة، يوم، أسبوع، شهر، أو دائماً")}
          ${item("word", "hash", "كتم كلمة أو وسم", "من هذا المنشور أو غيره")}
          ${d.authorBlocked ? item("unblock", "x", `إلغاء حظر ${h(a.name)}`, "") : item("block", "x", `حظر ${h(a.name)}`, d.linkedPreview?.linked ? `يشمل ${d.linkedPreview.linked} حساب مرتبط` : "يمنعه من رؤيتك والتواصل معك", "danger")}
          ${item("report", "flag", "إبلاغ", "ثلاث خطوات سريعة", "danger")}
          ${protect}${help}</div>`;
    const s = dialog(`<h4>${ic("shield", "sm")} أدوات الأمان</h4>${body}`, "أدوات الأمان");
    s.querySelectorAll("input[name=pt-aud]").forEach(r => r.onchange = async () => { try { await api("PUT", `/api/posts/${pid}/reply-settings`, { audience: r.value }); toast("يمكن الرد الآن: " + Core.AUDIENCE_LABELS[r.value]); } catch (e) { err(e); } });
    s.querySelectorAll("[data-pt]").forEach(b => b.addEventListener("click", (ev) => {
      const k = b.dataset.pt;
      if (k === "help") { closeSheet(); return; }
      ev.preventDefault();
      if (k === "mute") return muteSheet(a.id);
      if (k === "word") return muteWordSheet((S.hashtags?.(S.post(pid)?.text || "") || [])[0] ? "#" + S.hashtags(S.post(pid).text)[0] : "");
      if (k === "block") return blockSheet(a.id);
      if (k === "unblock") return api("DELETE", `/api/protection/blocks/${a.id}`).then(() => { DB.blocked = DB.blocked.filter(x => x !== a.id); save(); closeSheet(); toast("أُلغي الحظر"); rerender(); }, err);
      if (k === "report") return report3(pid, "post");
      if (k === "mode") return modeSheet();
      if (k === "hide") { closeSheet(); location.hash = "#/post/" + pid; }
    }));
  }

  /* =================== 3-step report =================== */
  const _reportFlow = typeof reportFlow === "function" ? reportFlow : null;
  function report3(target, kind) {
    if (!online()) return _reportFlow?.(target, kind);
    const author = authorOf(target, kind), mine = author === DB.me;
    const st = { step: 1, cat: null, sub: null, details: "", block: false, mute: false, hide: false };
    const post = kind === "comment" ? S.post((DB.comments || []).find(c => c.id === target)?.post) : null;
    const canHide = kind === "comment" && post?.author === DB.me;
    const steps = (n) => `<div class="pt-steps" aria-hidden="true">${[1, 2, 3].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div><p class="pt-sub" aria-live="polite">الخطوة ${["", "١", "٢", "٣"][n]} من ٣</p>`;
    const render = () => {
      const c = Core.REPORT.find(x => x.key === st.cat);
      let html = "";
      if (st.step === 1) html = `<h4>ماذا يحدث؟</h4>${steps(1)}<fieldset class="pt-opts" role="radiogroup" aria-label="نوع المشكلة">${Core.REPORT.map(x => `<label><input type="radio" name="pt-c" value="${x.key}" ${st.cat === x.key ? "checked" : ""}><span>${x.label}<small>${x.hint}</small></span></label>`).join("")}</fieldset>
        <div class="pt-row"><button class="btn" id="pt-n" ${st.cat ? "" : "disabled"}>التالي</button><button class="btn ghost" id="pt-x">إلغاء</button></div>`;
      if (st.step === 2) html = `<h4>${h(c.label)}: التفاصيل</h4>${steps(2)}
        ${c.help ? `<div class="pt-note warn" role="note">إن كان أحد في خطر الآن فاتصل بالرقم الموحد للطوارئ <a class="pt-tel" href="tel:911">911</a>. <a href="#/help/mental-health">جهات الدعم</a></div>` : ""}
        <fieldset class="pt-opts" role="radiogroup" aria-label="الوصف الأقرب">${c.subs.map((x) => `<label><input type="radio" name="pt-s" value="${x[0]}" ${(st.sub || c.subs[0][0]) === x[0] ? "checked" : ""}> ${x[1]}</label>`).join("")}</fieldset>
        <label class="pt-field"><span>تفاصيل إضافية (اختياري)</span><textarea id="pt-d" maxlength="1000" rows="3">${h(st.details)}</textarea></label>
        <div class="pt-row"><button class="btn" id="pt-n">التالي</button><button class="btn ghost" id="pt-b">رجوع</button></div>`;
      if (st.step === 3) html = `<h4>احمِ نفسك</h4>${steps(3)}<p class="pt-sub">اختياري: يُطبَّق مع البلاغ مباشرة.</p>
        <fieldset class="pt-opts" aria-label="إجراءات الحماية">
          ${author && !mine ? `<label><input type="checkbox" id="pt-bl" ${st.block ? "checked" : ""}><span>حظر ${h(S.user(author)?.name || "الحساب")}<small>مع الحسابات المرتبطة به</small></span></label>
          <label><input type="checkbox" id="pt-mu" ${st.mute ? "checked" : ""}><span>كتم ${h(S.user(author)?.name || "الحساب")} بدلاً من الحظر</span></label>` : ""}
          ${canHide ? `<label><input type="checkbox" id="pt-hd" ${st.hide ? "checked" : ""}><span>إخفاء هذا الرد من منشورك</span></label>` : ""}
        </fieldset>
        <p class="u-mt10 pt-sub">لن نخبر صاحب المحتوى بهويتك.</p>
        <div class="pt-row"><button class="u-bg-dg btn" id="pt-send">إرسال البلاغ</button><button class="btn ghost" id="pt-b">رجوع</button></div>`;
      const s = dialog(html, "إبلاغ");
      s.querySelector("#pt-x")?.addEventListener("click", closeSheet);
      s.querySelectorAll("input[name=pt-c]").forEach(r => r.onchange = () => { st.cat = r.value; st.sub = null; s.querySelector("#pt-n").disabled = false; });
      s.querySelectorAll("input[name=pt-s]").forEach(r => r.onchange = () => { st.sub = r.value; });
      const keep = () => { const d = s.querySelector("#pt-d"); if (d) st.details = d.value; const sub = s.querySelector("input[name=pt-s]:checked"); if (sub) st.sub = sub.value;
        st.block = !!s.querySelector("#pt-bl")?.checked; st.mute = !!s.querySelector("#pt-mu")?.checked; st.hide = !!s.querySelector("#pt-hd")?.checked; };
      s.querySelector("#pt-n")?.addEventListener("click", () => { keep(); st.step++; render(); });
      s.querySelector("#pt-b")?.addEventListener("click", () => { keep(); st.step--; render(); });
      s.querySelector("#pt-bl")?.addEventListener("change", (e) => { if (e.target.checked) s.querySelector("#pt-mu").checked = false; });
      s.querySelector("#pt-mu")?.addEventListener("change", (e) => { if (e.target.checked) s.querySelector("#pt-bl").checked = false; });
      s.querySelector("#pt-send")?.addEventListener("click", async (e) => {
        keep(); e.target.disabled = true;
        try {
          const r = await api("POST", "/api/protection/reports", { target, kind, category: st.cat, subcategory: st.sub, details: st.details || undefined, block: st.block, mute: st.mute, hide: st.hide });
          if (r.actions.includes("block") && author) Cmd.block(author);
          if (!DB.reports.some(x => x.id === r.id)) { DB.reports.push({ id: r.id, target, kind, reason: Core.reportReason(st.cat, st.sub).reason, by: DB.me, at: new Date().toISOString(), status: "open" }); save(); }
          done(r);
        } catch (x) { e.target.disabled = false; err(x); }
      });
    };
    const done = (r) => {
      const s = dialog(`<h4>${ic("check", "sm")} شكراً، وصلنا بلاغك</h4><p class="pt-sub">${r.priority >= 2 ? "صنّفناه عاجلاً وسيُراجع بأولوية." : "سيراجعه فريق السلامة."}${r.actions.length ? " وطبّقنا ما اخترته: " + r.actions.map(a => ({ block: "الحظر", mute: "الكتم", hide: "إخفاء الرد" })[a]).join("، ") + "." : ""}</p>
        ${r.help ? `<div class="pt-note warn" role="note">${h(r.help.disclaimer)}</div><div class="pt-res">${r.help.resources.map(resRow).join("")}</div>` : ""}
        <div class="pt-row"><button class="btn" id="pt-ok">تم</button></div>`, "تم الإبلاغ");
      s.querySelector("#pt-ok").onclick = () => { closeSheet(); rerender(); };
    };
    render();
    document.dispatchEvent(new CustomEvent("mp:report-open", { detail: { target, kind } }));
  }
  if (typeof reportFlow === "function") reportFlow = function (target, kind) { return online() ? report3(target, kind) : _reportFlow(target, kind); };

  /* =================== post cards: 🛡 button + timed feed mutes =================== */
  if (typeof postInner === "function") {
    const _pi = postInner;
    postInner = function (p, opts) {
      const html = _pi(p, opts);
      if (!online() || !p || p.status === "deleted" || !DB.me) return html;
      const btn = `<button class="pt-shield" data-safety="${h(p.id)}" aria-label="أدوات الأمان لهذا المنشور" title="أدوات الأمان">${ic("shield", "sm")}</button>`;
      const re = new RegExp(`(<button class="more" data-more="${p.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}")`);
      return re.test(html) ? html.replace(re, btn + "$1") : html;
    };
  }
  if (typeof postCard === "function") {
    const _pc = postCard;
    postCard = function (p, opts) {
      if (online() && p && ST.rules.length && p.author !== DB.me && !ST.reveal.has(p.id) && !(opts && opts.full)) {
        const hit = Core.muteHit({ text: [p.title, p.text].filter(Boolean).join(" "), author: p.author }, ST.rules, "feed");
        if (hit) return `<div class="card pt-mutedcard" data-pt-muted="${h(p.id)}"><span aria-hidden="true">${ic("volumeX", "sm")}</span><div class="grow">منشور مخفي ${hit.kind === "user" ? "من حساب كتمته" : `لاحتوائه «${h(hit.value)}» المكتومة`}</div><button class="btn ghost" data-pt-reveal="${h(p.id)}">عرض</button></div>`;
      }
      return _pc(p, opts);
    };
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-safety]"); if (b) { e.preventDefault(); e.stopImmediatePropagation(); safetySheet(b.dataset.safety); return; }
    const r = e.target.closest?.("[data-pt-reveal]"); if (r) { e.preventDefault(); ST.reveal.add(r.dataset.ptReveal); rerender(); }
  }, true);
  // the existing «⋯» menu also offers the safety tools
  if (typeof moreMenu === "function") {
    const _more = moreMenu;
    moreMenu = function (pid) {
      _more(pid);
      if (!online()) return;
      const menu = document.querySelector("#sheet .menu"); if (!menu || menu.querySelector("[data-pt-open]")) return;
      const b = document.createElement("button"); b.dataset.ptOpen = "1"; b.innerHTML = `${ic("shield", "sm")} أدوات الأمان`; b.onclick = () => safetySheet(pid); menu.prepend(b);
    };
  }

  /* =================== post page: hidden replies + reply audience =================== */
  async function enhancePost(pid) {
    if (!online() || !DB.me) return;
    let hr, rs; try { [hr, rs] = await Promise.all([api("GET", `/api/posts/${pid}/hidden-replies`), api("GET", `/api/posts/${pid}/reply-settings`)]); } catch { return; }
    if (!location.hash.startsWith("#/post/" + pid)) return;
    const hidden = new Set(hr.hidden);
    view.querySelectorAll("[data-crep]").forEach(btn => {
      const cid = btn.dataset.crep, el = btn.closest(".comment"); if (!el || el.dataset.ptDone) return; el.dataset.ptDone = "1";
      if (hr.canHide) { const t = document.createElement("button"); t.dataset.ptHide = cid; t.textContent = hidden.has(cid) ? "إظهار" : "إخفاء"; t.setAttribute("aria-label", hidden.has(cid) ? "إظهار الرد" : "إخفاء الرد"); btn.after(t);
        t.onclick = async () => { const on = !hidden.has(cid); try { await api(on ? "PUT" : "DELETE", `/api/comments/${cid}/hidden`); toast(on ? "أُخفي الرد" : "أصبح الرد ظاهراً"); rerender(); } catch (e) { err(e); } }; }
      if (hidden.has(cid)) {
        el.classList.add("pt-hidden");
        const rv = document.createElement("button"); rv.className = "pt-reveal"; rv.setAttribute("aria-expanded", "false"); rv.textContent = "رد مخفي من صاحب المنشور — اضغط للعرض";
        rv.onclick = () => { const open = el.classList.toggle("pt-open"); rv.setAttribute("aria-expanded", String(open)); rv.textContent = open ? "إخفاء الرد مجدداً" : "رد مخفي من صاحب المنشور — اضغط للعرض"; };
        el.prepend(rv);
      }
    });
    const bar = view.querySelector(".chatbar");
    if (bar && rs.audience !== "everyone" && !view.querySelector(".pt-audience")) {
      bar.insertAdjacentHTML("beforebegin", `<div class="pt-audience" role="note">${ic("lock", "xs")} يمكن الرد: ${h(rs.label)}${rs.canReply ? "" : " — لا يمكنك الرد على هذا المنشور"}</div>`);
      if (!rs.canReply) { const i = bar.querySelector("input"), b = bar.querySelector("button"); if (i) { i.disabled = true; i.placeholder = "الردود مقيّدة"; } if (b) b.disabled = true; }
    }
  }
  if (typeof Views !== "undefined" && Views.post) {
    const _post = Views.post;
    Views.post = function (pid) { const r = _post.apply(this, arguments); enhancePost(pid); return r; };
  }

  /* =================== screens =================== */
  const resRow = (r) => `<div class="r"><div class="grow"><b>${h(r.name)}</b><small>${h(r.desc)}${r.hours ? " · " + h(r.hours) : ""}</small>
    ${r.url && r.url.startsWith("https://") ? `<small><a href="${h(r.url)}" target="_blank" rel="noopener">الموقع الرسمي</a></small>` : r.url ? `<small><a href="${h(r.url)}">فتح</a></small>` : ""}</div>
    ${r.phone ? `<a class="pt-tel" href="tel:${h(r.phone)}" aria-label="اتصال بـ ${h(r.name)}: ${h(r.phone)}">${h(r.phone)}</a>` : r.placeholder ? `<small class="muted">سيُضاف الرقم المعتمد قريباً</small>` : ""}
    ${DB.isAdmin && r.category !== "platform" ? `<button class="btn ghost" data-pt-res="${h(r.key)}" aria-label="تعديل ${h(r.name)}">تعديل</button>` : ""}</div>`;
  const block = (b) => b[0] === "p" ? `<p>${h(b[1])}</p>` : b[0] === "h" ? `<h3>${h(b[1])}</h3>` : b[0] === "ul" ? `<ul>${b[1].map(x => `<li>${h(x)}</li>`).join("")}</ul>` : b[0] === "link" ? `<p><a href="${h(b[2])}">${h(b[1])} ←</a></p>` : "";

  async function helpView(slug) {
    view.innerHTML = `<div class="wrap"><div class="skel"></div><div class="skel"></div></div>`;
    try { ST.help = ST.help && !DB.isAdmin ? ST.help : await api("GET", "/api/help"); } catch (e) { view.innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
    const d = ST.help;
    const disclaimer = `<div class="notice warn" role="note">${ic("flag", "sm")}<span>${h(d.disclaimer)}</span></div>`;
    if (slug) {
      let a; try { a = (await api("GET", `/api/help/articles/${enc(slug)}`)).article; } catch { view.innerHTML = `<div class="empty">الصفحة غير موجودة</div>`; return; }
      const res = a.topic === "wellbeing" ? `<section class="card" aria-labelledby="pt-rh"><h3 id="pt-rh">جهات دعم</h3><div class="pt-res">${d.resources.filter(r => ["emergency", "mental", "family", "child"].includes(r.category)).map(resRow).join("")}</div></section>` : "";
      view.innerHTML = `<div class="wrap"><a href="#/help" class="muted">→ مركز المساعدة</a><article class="u-mt8 card pt-art"><h2>${h(a.title)}</h2><p class="muted">${h(a.summary)}</p>${a.body.map(block).join("")}</article>${a.topic === "wellbeing" ? disclaimer : ""}${res}</div>`;
    } else {
      const cats = Object.entries(d.categories).map(([k, l]) => { const rs = d.resources.filter(r => r.category === k); return rs.length ? `<h3 class="u-m0 u-mt14 u-mb6">${h(l)}</h3><div class="pt-res">${rs.map(resRow).join("")}</div>` : ""; }).join("");
      view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "مركز المساعدة والأمان", icon: "help" })}${disclaimer}
        <section class="card" aria-labelledby="pt-ah"><h3 id="pt-ah">أدلة سريعة</h3><div class="pt-menu">${d.articles.map(a => `<a href="#/help/${h(a.slug)}"><span>${h(a.title)}<small>${h(a.summary)}</small></span></a>`).join("")}</div></section>
        <section class="card" aria-labelledby="pt-sh"><h3 id="pt-sh">أدواتك</h3><div class="pt-menu"><a href="#/protection">${ic("shield", "sm")}<span>الحظر والكتم ووضع الحماية</span></a><a href="#/policies">${ic("flag", "sm")}<span>سياسات المحتوى</span></a></div></section>
        <section class="card" aria-labelledby="pt-rh2"><h3 id="pt-rh2">جهات الدعم والطوارئ</h3><p class="muted">أرقام رسمية تم التحقق منها من مصادرها، للتوعية فقط.</p>${cats}</section></div>`;
      view.querySelectorAll("[data-pt-res]").forEach(b => b.onclick = () => resourceEditor(d.resources.find(r => r.key === b.dataset.ptRes)));
    }
  }
  function resourceEditor(r) {
    const s = dialog(`<h4>تعديل: ${h(r.name)}</h4><p class="pt-sub">أدخل رقماً أو رابطاً رسمياً بعد التحقق منه من مصدره.</p>
      <label class="pt-field"><span>الرقم</span><input id="pt-ph" dir="ltr" maxlength="20" value="${h(r.phone || "")}"></label>
      <label class="pt-field"><span>الرابط (https)</span><input id="pt-ur" dir="ltr" maxlength="300" value="${h(r.url || "")}"></label>
      <label class="pt-field"><span>ساعات العمل</span><input id="pt-hs" maxlength="60" value="${h(r.hours || "")}"></label>
      <label class="pt-field"><span>مصدر التحقق (رابط)</span><input id="pt-src" dir="ltr" maxlength="300" value="${h(r.source || "")}"></label>
      <div class="pt-row"><button class="btn" id="pt-go">حفظ</button><button class="btn ghost" id="pt-x">إلغاء</button></div>`, "تعديل مورد");
    s.querySelector("#pt-x").onclick = closeSheet;
    s.querySelector("#pt-go").onclick = async () => { try { await api("PUT", `/api/admin/help/resources/${enc(r.key)}`, { phone: s.querySelector("#pt-ph").value.trim() || null, url: s.querySelector("#pt-ur").value.trim() || null, hours: s.querySelector("#pt-hs").value.trim() || null, source: s.querySelector("#pt-src").value.trim() || null }); ST.help = null; closeSheet(); toast("تم الحفظ"); helpView(); } catch (e) { err(e); } };
  }

  async function protectionView() {
    view.innerHTML = `<div class="wrap"><div class="skel"></div><div class="skel"></div></div>`;
    let d; try { d = await api("GET", "/api/protection"); } catch (e) { view.innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
    ST.mode = d.mode; ST.modeAt = Date.now(); ST.rules = d.mutes.filter(r => !r.legacy);
    const m = d.mode;
    const muteLabel = (r) => r.kind === "user" ? (S.user(r.value)?.name || "حساب") : (r.kind === "hashtag" ? "#" : "") + r.value;
    const scopeL = { all: "كل مكان", feed: "الخلاصة", notifications: "الإشعارات", replies: "الردود" };
    view.innerHTML = `<div class="wrap"><h2>${ic("shield")} الحماية</h2>
      ${m.suggestion ? `<div class="pt-banner" role="alert"><p>رصدنا نشاطاً غير معتاد على حسابك من حسابات لا تعرفها. نقترح تشغيل وضع الحماية.</p><button class="btn" data-pt-on="24">تشغيل ٢٤ ساعة</button><button class="btn ghost" id="pt-dis">لاحقاً</button></div>` : ""}
      <section class="card" aria-labelledby="pt-mh"><div class="row"><b id="pt-mh" class="grow">وضع الحماية</b><span class="chip">${m.active ? "مفعّل" : "متوقف"}</span></div>
        <p class="muted">${m.active ? `حتى ${h(fmt(m.endsAt))}. تصلك الردود والرسائل والإشارات ممن تتابعهم ومتابعيك القدامى فقط.` : "استخدمه عند التعرض لموجة إساءة: يقيّد مؤقتاً من يمكنه الرد والمراسلة والإشارة إليك."}</p>
        <div class="pt-row"><button class="btn" id="pt-mode">${m.active ? "إيقاف" : "تشغيل…"}</button></div>
        <label class="u-dflex u-g8 u-aic u-mt10"><input type="checkbox" id="pt-auto" ${m.auto ? "checked" : ""}> تشغيل تلقائي لمدة ٢٤ ساعة عند رصد موجة إساءة</label></section>
      <section class="card" aria-labelledby="pt-bh"><h3 id="pt-bh">الحسابات المحظورة (${d.blocks.length})</h3>
        <label class="u-dflex u-g8 u-aic"><input type="checkbox" id="pt-bl" ${d.blockLinked ? "checked" : ""}> احظر الحسابات المرتبطة تلقائياً${d.linkedTotal ? ` (${d.linkedTotal} محظور حالياً بالارتباط)` : ""}</label>
        <div class="pt-list">${d.blocks.map(u => `<div class="row"><span class="grow"><b>${h(u.name)}</b> <span class="muted">@${h(u.handle)}${u.linkedBlocked ? ` · +${u.linkedBlocked} مرتبط` : ""}</span></span><button class="btn ghost" data-pt-ub="${h(u.id)}" aria-label="إلغاء حظر ${h(u.name)}">إلغاء الحظر</button></div>`).join("") || '<p class="muted">لا أحد</p>'}</div></section>
      <section class="card" aria-labelledby="pt-kh"><div class="row"><h3 id="pt-kh" class="grow">الكتم</h3><button class="btn ghost" id="pt-addw">${ic("plus", "sm")} كلمة أو وسم</button></div>
        <div class="pt-list">${d.mutes.map(r => `<div class="row"><span class="grow"><b>${h(muteLabel(r))}</b> <span class="muted">${scopeL[r.scope] || ""}${r.wholeWord ? " · كلمة كاملة" : ""} · ${r.expiresAt ? "حتى " + h(fmt(r.expiresAt)) : "دائماً"}</span></span>${r.id ? `<button class="btn ghost" data-pt-um="${h(r.id)}" aria-label="إلغاء كتم ${h(muteLabel(r))}">إلغاء</button>` : `<span class="muted">من الإعدادات</span>`}</div>`).join("") || '<p class="muted">لا شيء مكتوم</p>'}</div></section>
      <section class="card"><div class="pt-menu"><a href="#/help">${ic("sparkle", "sm")}<span>مركز المساعدة والدعم</span></a><a href="#/policies">${ic("flag", "sm")}<span>سياسات المحتوى</span></a></div></section></div>`;
    $("#pt-mode").onclick = () => m.active ? setMode({ active: false }).then(() => { toast("أُوقف وضع الحماية"); protectionView(); }, err) : modeSheet();
    view.querySelector("[data-pt-on]")?.addEventListener("click", () => setMode({ active: true, hours: 24, reason: "suggested" }).then(() => { toast("تم تشغيل وضع الحماية"); removeBanner(); protectionView(); }, err));
    $("#pt-dis")?.addEventListener("click", () => api("POST", "/api/protection/mode/dismiss").then(() => { removeBanner(); protectionView(); }, err));
    $("#pt-auto").onchange = (e) => setMode({ auto: e.target.checked }).then(() => toast(e.target.checked ? "سيُفعَّل تلقائياً عند رصد موجة" : "أُلغي التفعيل التلقائي"), err);
    $("#pt-bl").onchange = (e) => api("PUT", "/api/protection/settings", { blockLinked: e.target.checked }).then(() => protectionView(), err);
    $("#pt-addw").onclick = () => muteWordSheet();
    view.querySelectorAll("[data-pt-ub]").forEach(b => b.onclick = () => api("DELETE", `/api/protection/blocks/${b.dataset.ptUb}`).then(() => { DB.blocked = DB.blocked.filter(x => x !== b.dataset.ptUb); save(); toast("أُلغي الحظر"); protectionView(); }, err));
    view.querySelectorAll("[data-pt-um]").forEach(b => b.onclick = () => api("DELETE", `/api/protection/mutes/${b.dataset.ptUm}`).then(() => { toast("أُلغي الكتم"); loadRules(); protectionView(); }, err));
  }

  /** policy body: safe subset — "## heading", "- item", blank-line paragraphs */
  const policyHtml = (body) => String(body || "").split(/\n{2,}/).map(chunk => {
    const lines = chunk.split("\n");
    if (lines.every(l => /^\s*- /.test(l))) return `<ul>${lines.map(l => `<li>${h(l.replace(/^\s*- /, ""))}</li>`).join("")}</ul>`;
    return lines.map(l => /^## /.test(l) ? `<h3>${h(l.slice(3))}</h3>` : /^\s*- /.test(l) ? `<ul><li>${h(l.replace(/^\s*- /, ""))}</li></ul>` : `<p>${h(l)}</p>`).join("");
  }).join("");
  async function policiesView(slug) {
    view.innerHTML = `<div class="wrap"><div class="skel"></div></div>`;
    try {
      if (!slug) {
        const d = await api("GET", "/api/policies"); localStorage.setItem("mp_policy_rev", d.revision);
        view.innerHTML = `<div class="wrap"><h2>${ic("flag")} سياسات المحتوى</h2><p class="muted">تُحدَّث مركزياً، ويمكنك الاطلاع على الإصدارات السابقة.</p>
          <div class="pt-menu">${d.policies.map(p => `<a href="#/policies/${h(p.slug)}"><span>${h(p.title)}<small>${h(p.summary)} · الإصدار ${p.version}${p.publishedAt ? " · " + h(fmt(p.publishedAt)) : ""}</small></span></a>`).join("")}</div>
          ${DB.isAdmin ? `<div class="pt-row"><button class="btn ghost" id="pt-new">${ic("plus", "sm")} سياسة جديدة</button></div>` : ""}</div>`;
        $("#pt-new")?.addEventListener("click", () => policyEditor({}));
        return;
      }
      const v = new URLSearchParams(location.hash.split("?")[1] || "").get("v");
      const d = await api("GET", `/api/policies/${enc(slug)}${v ? "?version=" + enc(v) : ""}`), p = d.policy;
      view.innerHTML = `<div class="wrap"><a href="#/policies" class="muted">→ السياسات</a><article class="u-mt8 card pt-pol"><h2>${h(p.title)}</h2>
        <p class="muted">الإصدار ${p.version}${p.status !== "published" ? ` (${p.status === "draft" ? "مسودة" : "سابق"})` : ""}${p.publishedAt ? " · نُشر " + h(fmt(p.publishedAt)) : ""}${p.changelog ? " · " + h(p.changelog) : ""}</p>${policyHtml(p.body)}</article>
        ${d.versions.length > 1 ? `<section class="card"><h3>الإصدارات</h3><div class="pt-menu">${d.versions.map(x => `<a href="#/policies/${h(slug)}?v=${x.version}"><span>الإصدار ${x.version}<small>${{ published: "الحالي", archived: "سابق", draft: "مسودة" }[x.status] || ""}${x.changelog ? " · " + h(x.changelog) : ""}</small></span></a>`).join("")}</div></section>` : ""}
        ${DB.isAdmin ? `<div class="pt-row"><button class="btn ghost" id="pt-ed">تحرير كإصدار جديد</button>${p.status === "draft" ? `<button class="btn" id="pt-pub">نشر هذا الإصدار</button>` : ""}</div>` : ""}</div>`;
      $("#pt-ed")?.addEventListener("click", () => policyEditor(p));
      $("#pt-pub")?.addEventListener("click", () => api("POST", `/api/admin/policies/${enc(slug)}/publish`, { version: p.version }).then(() => { toast("نُشرت السياسة"); location.hash = "#/policies/" + slug; }, err));
    } catch (e) { view.innerHTML = `<div class="empty">${h(e.message)}</div>`; }
  }
  function policyEditor(p) {
    const s = dialog(`<h4>${p.slug ? "إصدار جديد: " + h(p.title) : "سياسة جديدة"}</h4><p class="pt-sub">يُحفظ كمسودة، ثم تنشره من صفحة السياسة. الصياغة: «## عنوان» و«- بند».</p>
      ${p.slug ? "" : `<label class="pt-field"><span>المعرّف (إنجليزي)</span><input id="pt-sl" dir="ltr" maxlength="40" placeholder="privacy"></label>`}
      <label class="pt-field"><span>العنوان</span><input id="pt-ti" maxlength="120" value="${h(p.title || "")}"></label>
      <label class="pt-field"><span>الملخص</span><input id="pt-su" maxlength="300" value="${h(p.summary || "")}"></label>
      <label class="pt-field"><span>النص</span><textarea id="pt-bo" rows="10">${h(p.body || "")}</textarea></label>
      <label class="pt-field"><span>ما الذي تغيّر؟</span><input id="pt-ch" maxlength="500"></label>
      <div class="pt-row"><button class="btn" id="pt-go">حفظ كمسودة</button><button class="btn ghost" id="pt-x">إلغاء</button></div>`, "تحرير سياسة");
    s.querySelector("#pt-x").onclick = closeSheet;
    s.querySelector("#pt-go").onclick = async () => {
      const slug = p.slug || s.querySelector("#pt-sl").value.trim();
      try { const r = await api("POST", "/api/admin/policies", { slug, title: s.querySelector("#pt-ti").value, summary: s.querySelector("#pt-su").value, body: s.querySelector("#pt-bo").value, changelog: s.querySelector("#pt-ch").value || undefined });
        closeSheet(); toast("حُفظت المسودة"); location.hash = `#/policies/${slug}?v=${r.policy.version}`; } catch (e) { err(e); }
    };
  }

  /* =================== wave suggestion banner + realtime =================== */
  function removeBanner() { document.getElementById("pt-wave")?.remove(); }
  async function maybeBanner() {
    if (!online() || !DB.me) return;
    const r = (location.hash.split("/")[1] || "home").split("?")[0]; if (!["home", "notifications", ""].includes(r)) return;
    const m = await getMode(); if (!m?.suggestion || document.getElementById("pt-wave")) return;
    const host = view.querySelector(".wrap"); if (!host) return;
    host.insertAdjacentHTML("afterbegin", `<div class="pt-banner" id="pt-wave" role="alert"><p>${ic("shield", "sm")} رصدنا نشاطاً غير معتاد على حسابك. هل تريد تشغيل وضع الحماية ٢٤ ساعة؟</p><button class="btn" id="pt-w-on">تشغيل</button><button class="btn ghost" id="pt-w-no">لاحقاً</button></div>`);
    $("#pt-w-on").onclick = () => setMode({ active: true, hours: 24, reason: "suggested" }).then(() => { removeBanner(); toast("تم تشغيل وضع الحماية"); }, err);
    $("#pt-w-no").onclick = () => api("POST", "/api/protection/mode/dismiss").then(() => { ST.mode = null; removeBanner(); }, err);
  }
  let boundEs = null;
  function bindStream() {
    const es = typeof Remote !== "undefined" ? Remote.es : null; if (!es || es === boundEs) return; boundEs = es;
    es.addEventListener("protection_suggest", () => { ST.mode = null; maybeBanner(); });
    es.addEventListener("policy_updated", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { } toast(`تم تحديث «${d.title || "سياسات المحتوى"}»`); });
  }

  /* =================== settings entry + routes =================== */
  if (typeof Views !== "undefined" && Views.settings) {
    MPSettings.add(function () { if (online() && !view.querySelector("#pt-set")) view.querySelector(".wrap")?.insertAdjacentHTML("beforeend", `<section class="card" id="pt-set" aria-labelledby="pt-seth"><h3 id="pt-seth">${ic("shield", "sm")} الأمان والحماية</h3><div class="pt-menu"><a href="#/protection"><span>الحظر والكتم ووضع الحماية</span></a><a href="#/help"><span>مركز المساعدة والدعم النفسي</span></a><a href="#/policies"><span>سياسات المحتوى</span></a></div></section>`); });
  }
  MPRoutes.extend((a, b, base) => {
    if (!online()) return base;
    return { help: () => helpView(a && a.split("?")[0]), protection: () => protectionView(), policies: () => policiesView(a && a.split("?")[0]) };
  });
  addEventListener("hashchange", () => { setTimeout(maybeBanner, 300); bindStream(); });
  (function boot(n = 0) { if (window.MPSession && !MPSession.signedIn()) return MPSession.whenIn(() => boot(n)); /* v2.51: guests: nothing to load */ if (!online()) return n < 20 ? setTimeout(() => boot(n + 1), 1500) : undefined; loadRules().then(() => { if (ST.rules.length) rerender(); }); bindStream(); setTimeout(maybeBanner, 800); })();

  window.MPProtection = { safetySheet, report3, muteSheet, muteWordSheet, blockSheet, modeSheet, helpView, protectionView, policiesView, loadRules, state: ST };
})();
