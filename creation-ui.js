/* =====================================================================
 * مجتمع بلس — creator studio + live audio rooms (lazy "creation" chunk + creation.css, v2.42.0).
 * Moved out of core content-ui.js to free core budget; the screens are unchanged.
 *   #/studio   overview, calendar (drag to reschedule), best time, recycle, templates, weekly card
 *   #/rooms · #/room/:id   live audio rooms (WebRTC mesh / LiveKit token), hand raise, host recording
 * Public: window.MPStudio = { studioView, postStatsSheet, roomsView, roomView, leaveRoom, inRoom }.
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function CreationUI() {
  if (window.MPStudio) return;
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (...a) => Remote.api(...a);
  const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n || 0));
  const rid = (p) => p + "_" + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  const lcl = () => { const L = (window.MPI18n && MPI18n.current && MPI18n.current()) || "ar"; return L === "ar" ? "ar" : L; }; // v2.61 i18n: dates follow the UI language (Arabic output unchanged)
  const dow3 = (i) => (lcl() === "ar" ? DAYS[i].slice(0, 3) : new Date(2023, 0, 1 + i).toLocaleDateString(lcl(), { weekday: "short" })); // 2023-01-01 = Sunday
  const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const composer = (...a) => window.MPComposer(...a);
  /* =================== Studio goals + «روابطك» (v2.61, studio-goals-links) ===================
   * Goals: the creator picks 1–3 goals (posts this week · total followers · MJT balance) with progress bars computed from
   * existing data (GET /api/studio/calendar for this + last month, /api/studio/overview totals.followersTotal, /api/mjt/me).
   * Stored per account in the existing user prefs (PUT /api/prefs ns "studio" key "goals" — no migration).
   * Tips earned in Pi stay listed as «غير مفعّل بعد» until Pi activation (never hidden).
   * «روابطك»: managed communities, MJT wallet, earnings (Pi «غير مفعّل بعد»), support page, support settings.
   * Own section #st-goals, mounted before the tabs (so it sits under the «ابدأ هنا» block that mounts right under the head). */
  const SGL_KINDS = {
    posts: { icon: "pen", title: "منشورات هذا الأسبوع", unit: "منشور", units: "منشورات", def: 3, max: 50 },
    followers: { icon: "users", title: "إجمالي المتابعين", unit: "متابع", def: 100, max: 1e6 },
    mjt: { icon: "coin", title: "رصيد مجتمع كوين", unit: "MJT", def: 50, max: 1e7 }
  };
  const sglClean = (arr) => (Array.isArray(arr) ? arr : []).filter((g) => g && SGL_KINDS[g.k]).map((g) => ({ k: g.k, target: Math.min(SGL_KINDS[g.k].max, Math.max(1, Math.round(+g.target) || SGL_KINDS[g.k].def)) })).filter((g, i, a) => a.findIndex((x) => x.k === g.k) === i).slice(0, 3);
  async function sglData() {
    const q = (u) => api("GET", u).catch(() => null), now = new Date(), cur = now.toISOString().slice(0, 7), wk = Date.now() - 7 * 864e5;
    const prevD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), prev = prevD.toISOString().slice(0, 7);
    const needPrev = new Date(wk).toISOString().slice(0, 7) !== cur;
    const [prefs, c1, c0, ov, mjt, comms, tips] = await Promise.all([q("/api/prefs?ns=studio"), q("/api/studio/calendar?month=" + cur), needPrev ? q("/api/studio/calendar?month=" + prev) : null, q("/api/studio/overview?days=7"), q("/api/mjt/me"), q("/api/me/communities/managed"), q("/api/mjt/tips/received")]);
    const items = [...((c1 && c1.items) || []), ...((c0 && c0.items) || [])];
    const bal = mjt && mjt.balance ? parseFloat(String(mjt.balance.mjt).replace(/,/g, "")) : NaN;
    return {
      goals: sglClean(prefs && prefs.prefs && prefs.prefs.studio && prefs.prefs.studio.goals),
      have: { posts: c1 ? items.filter((i) => i.status === "published" && Date.parse(i.at) >= wk).length : null, followers: ov && ov.totals ? ov.totals.followersTotal ?? null : null, mjt: Number.isFinite(bal) ? bal : null },
      tips: tips && tips.last30 ? tips : null, // v2.74 MJT tips on clips (last 30 days)
      comms: ((comms && comms.communities) || []).filter((c) => !c.archivedAt && (c.role === "owner" || c.role === "admin")).slice(0, 4)
    };
  }
  function sglGoalRow(g, have) {
    const K = SGL_KINDS[g.k], v = have[g.k], known = v !== null && v !== undefined, pct = known ? Math.min(100, Math.round((v / g.target) * 100)) : 0, done = known && v >= g.target;
    const shown = g.k === "mjt" && known ? (Math.round(v * 100) / 100).toLocaleString("en-US") : fmtN(v);
    return `<li class="sgl-goal"><div class="row"><span class="sgl-ic" aria-hidden="true">${ic(K.icon, "sm")}</span><b class="grow">${K.title}</b>${done ? `<span class="sbadge ok">${ic("check", "xs")}تحقق</span>` : ""}<span class="sgl-num"><bdi>${known ? shown : "—"}</bdi> / <bdi>${fmtN(g.target)}</bdi> <span class="muted">${K.units && g.target !== 1 && (window.MPI18n?.current?.() || "ar") !== "ar" ? K.units : K.unit}</span></span></div>
      <div class="fn-bar" role="progressbar" aria-label="${K.title}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${pct}%"><i style="width:${pct}%"></i></div></li>`;
  }
  function sglLinks(d) {
    const me = (typeof S !== "undefined" && S.me && S.me()) || {}, a = (href, icon, label, tag) => `<a href="${href}">${ic(icon, "sm")}<span class="grow">${label}</span>${tag ? `<span class="sbadge">${tag}</span>` : ""}</a>`;
    const comms = d.comms.length ? d.comms.map((c) => a(`#/c/${encodeURIComponent(c.id)}`, "community", `<bdi>${esc(c.name)}</bdi>`)).join("") : a("#/communities", "community", "مجتمعاتك");
    const tipTag = d.tips && d.tips.last30.count ? `<span data-noi18n dir="ltr">+${esc(d.tips.last30.total)} MJT</span>` : "";
    return comms + a("#/mjt", "wallet", "محفظة مجتمع كوين") + a("#/mjt?tab=history", "gift", "إكراميات اللقطات · آخر ٣٠ يوماً", tipTag) + a("#/earnings", "chart", "أرباحك (Pi)", "غير مفعّل بعد") + (me.handle ? a(`#/support/${encodeURIComponent(me.handle)}`, "heart", "صفحة الدعم") : "") + a("#/creator", "handshake", "إعدادات الإكراميات والدعم");
  }
  async function goalsMount() {
    const host = view.querySelector(".wrap.studio .seg"); if (!host) return;
    let box = view.querySelector("#st-goals");
    if (!box) { host.insertAdjacentHTML("beforebegin", `<section id="st-goals" class="sgl" aria-labelledby="sgl-h"><div class="skel"></div></section>`); box = view.querySelector("#st-goals"); }
    const d = await sglData(); if (!box.isConnected) return;
    view._sglData = d;
    const goals = d.goals.length ? `<ul class="sgl-goals">${d.goals.map((g) => sglGoalRow(g, d.have)).join("")}</ul>` : `<p class="muted u-m0">اختر من هدف إلى ثلاثة أهداف وتابع تقدّمك هنا.</p>`;
    box.innerHTML = `<div class="card sgl-card"><div class="row"><h3 id="sgl-h" class="grow u-m0">${ic("target", "sm")}أهدافك</h3><button class="btn outline sm" id="sgl-edit" aria-haspopup="dialog">${d.goals.length ? "تعديل الأهداف" : "اختر أهدافك"}</button></div>${goals}</div>
      <h3 class="sgl-lh" id="sgl-lh">روابطك</h3><nav class="explore-shortcuts sgl-links" aria-labelledby="sgl-lh">${sglLinks(d)}</nav>`;
    box.querySelector("#sgl-edit").onclick = () => sglEditor(d);
  }
  function sglEditor(d) {
    const cur = new Map(d.goals.map((g) => [g.k, g.target]));
    sheet(`<div class="sgl-ed" role="dialog" aria-modal="true" aria-labelledby="sgl-eh"><h4 id="sgl-eh" class="u-mt0">أهدافك</h4><p class="muted">اختر من ١ إلى ٣ أهداف وحدّد الرقم الذي تريد الوصول إليه.</p>
      ${Object.entries(SGL_KINDS).map(([k, K]) => `<div class="sgl-opt"><label class="row"><input type="checkbox" data-gk="${k}" ${cur.has(k) ? "checked" : ""}><span class="grow">${K.title}</span></label><label class="sgl-tg"><span class="muted">الهدف</span><input type="number" inputmode="numeric" min="1" max="${K.max}" id="sgl-t-${k}" value="${cur.get(k) || K.def}" aria-label="${K.title} — الهدف"></label></div>`).join("")}
      <div class="sgl-opt sgl-off"><label class="row"><input type="checkbox" disabled aria-describedby="sgl-pi"><span class="grow">إكراميات Pi</span></label><span class="sbadge" id="sgl-pi">غير مفعّل بعد</span></div>
      <p class="sgl-err" id="sgl-err" role="alert"></p><button class="btn block" id="sgl-save">حفظ الأهداف</button><button class="btn outline block u-mt8" id="sgl-x">إلغاء</button></div>`);
    const err = $("#sgl-err"), boxes = [...document.querySelectorAll("#sheet [data-gk]")];
    const check = () => { const n = boxes.filter((b) => b.checked).length; err.textContent = n > 3 ? "اختر ٣ أهداف كحد أقصى" : ""; $("#sgl-save").disabled = n > 3; };
    boxes.forEach((b) => (b.onchange = check)); boxes[0]?.focus();
    $("#sgl-x").onclick = () => closeSheet();
    $("#sgl-save").onclick = async () => {
      const goals = sglClean(boxes.filter((b) => b.checked).map((b) => ({ k: b.dataset.gk, target: $("#sgl-t-" + b.dataset.gk).value })));
      try { await api("PUT", "/api/prefs", { ns: "studio", values: { goals } }); closeSheet(); toast("حُفظت الأهداف"); goalsMount(); } catch (e) { err.textContent = e.message; }
    };
  }
  async function roomsView() {
    view.innerHTML = `<div class="wrap"><div class="row"><h2 class="grow">${ic("mic")} الغرف الصوتية</h2><button class="btn" id="rm-new">${ic("plus", "xs")} غرفة</button></div><div class="skel"></div></div>`;
    if (!online()) { view.querySelector(".skel").outerHTML = `<div class="empty">الغرف المباشرة تتطلب الاتصال</div>`; return; }
    const { rooms } = await api("GET", "/api/rooms"); view.querySelector(".skel")?.remove();
    view.querySelector(".wrap").insertAdjacentHTML("beforeend", rooms.map(r => `<a class="card room-card" href="#/room/${r.id}"><span class="live-dot">مباشر</span><b>${esc(r.title)}</b><div class="u-g8 u-mt8 row">${av(r.host, "sm")}<span class="muted grow">${esc(r.host.name)}</span><span class="muted">${ic("mic", "xs")} ${r.speakers} · ${ic("users", "xs")} ${r.listeners}</span></div></a>`).join("") || `<div class="empty">لا غرف مباشرة الآن. افتح غرفة وادعُ متابعيك للنقاش.</div>`);
    $("#rm-new").onclick = () => { sheet(`<h4 class="u-mt0">غرفة صوتية جديدة</h4><input id="rm-t" placeholder="عنوان النقاش" maxlength="100" aria-label="العنوان"><p class="muted">سيصل إشعار لمتابعيك عند البدء.</p><button class="btn block" id="rm-go">ابدأ الآن</button>`); $("#rm-go").onclick = async () => { try { const s = await api("POST", "/api/rooms", { title: $("#rm-t").value.trim() }); closeSheet(); location.hash = "#/room/" + s.room.id; } catch (e) { toast(e.message); } }; };
  }
  const RTC = { room: null, me: null, pcs: new Map(), local: null, ice: [], audios: new Map(), rec: null, analysers: new Map(), raf: 0 };
  async function roomView(id) {
    view.innerHTML = `<div class="wrap"><div class="skel"></div></div>`;
    if (!online()) return;
    let s; try { s = await api("POST", `/api/rooms/${id}/join`); } catch (e) { view.querySelector(".wrap").innerHTML = `<a href="#/rooms" class="muted">→ الغرف</a><div class="empty">${esc(e.message)}</div>`; return; }
    if (RTC.room && RTC.room !== id) await leaveRoom(true);
    RTC.room = id; RTC.me = DB.me; RTC.state = s;
    const tk = await api("GET", `/api/rooms/${id}/token`); RTC.ice = tk.iceServers || []; RTC.mode = tk.mode;
    renderRoom(); await syncMedia();
  }
  function renderRoom() {
    const s = RTC.state; if (!s || location.hash.split("/")[1] !== "room") return;
    const me = s.members.find(m => m.id === DB.me) || { role: "listener" }, host = me.role === "host", speakers = s.members.filter(m => m.role !== "listener"), listeners = s.members.filter(m => m.role === "listener");
    const tile = (m) => `<div class="spk ${m.muted ? "muted" : ""}" data-spk="${m.id}"><span class="av lg" style="background:${m.color}">${m.avatar ? `<img src="${esc(m.avatar["200"])}" alt="">` : esc(m.name[0])}</span><b>${esc(m.name.split(" ")[0])}</b><span class="muted">${m.role === "host" ? "المضيف" : "متحدث"}${m.muted ? " · " + ic("micOff", "xs") : ""}</span>${host && m.role === "speaker" ? `<button class="chip" data-demote="${m.id}">إلى المستمعين</button>` : ""}</div>`;
    view.innerHTML = `<div class="wrap room"><a href="#/rooms" class="muted">→ الغرف</a>
      <div class="room-head"><span class="live-dot">${s.room.status === "live" ? "مباشر" : "انتهت"}</span><h2>${esc(s.room.title)}</h2><span class="muted">${s.members.length} في الغرفة · ${RTC.mode === "livekit" ? "LiveKit" : "اتصال مباشر"}</span></div>
      <h4>المتحدثون</h4><div class="spk-grid">${speakers.map(tile).join("")}</div>
      <h4>المستمعون <span class="muted">(${listeners.length})</span></h4><div class="lst-grid">${listeners.map(m => `<div class="lst">${av({ ...m, handle: m.handle }, "")}<span>${esc(m.name.split(" ")[0])}</span>${m.hand ? `<span class="hand" title="رفع يده"><svg class=ei aria-hidden=true><use href=#i-raise /></svg></span>` : ""}${host && m.hand ? `<button class="chip" data-promote="${m.id}">دعوة للحديث</button>` : ""}</div>`).join("")}</div>
      ${s.room.status === "live" ? `<div class="room-bar">${me.role !== "listener" ? `<button class="btn ${me.muted ? "ghost" : ""}" id="rm-mic">${ic(me.muted ? "micOff" : "mic", "sm")} ${me.muted ? "تشغيل الميكروفون" : "كتم"}</button>` : `<button class="btn ghost" id="rm-hand"><svg class=ei aria-hidden=true><use href=#i-raise /></svg> ${me.hand ? "إنزال اليد" : "رفع اليد"}</button>`}
        ${!host ? `<button class="btn ghost" id="rm-tip" aria-haspopup="dialog">${ic("coin", "sm")} <span>إكرامية</span></button>` : ""}
        ${host ? `<button class="btn ghost" id="rm-rec">${RTC.rec ? "⏺ إيقاف التسجيل" : "⏺ تسجيل"}</button><button class="btn danger" id="rm-end">إنهاء</button>` : `<button class="btn ghost" id="rm-leave">مغادرة</button>`}</div>` : `<div class="empty">انتهت الغرفة${s.room.recordingPost ? ` · <a href="#/post/${s.room.recordingPost}">استمع للتسجيل</a>` : ""}</div>`}</div>`;
    const q = (x) => view.querySelector(x);
    q("#rm-hand")?.addEventListener("click", () => api("POST", `/api/rooms/${RTC.room}/hand`, { up: !me.hand }).then(st => { RTC.state = st; renderRoom(); }));
    q("#rm-mic")?.addEventListener("click", async () => { const muted = !me.muted; if (RTC.local) RTC.local.getAudioTracks().forEach(t => t.enabled = !muted); RTC.state = await api("POST", `/api/rooms/${RTC.room}/mute`, { muted }); renderRoom(); });
    q("#rm-leave")?.addEventListener("click", () => leaveRoom().then(() => location.hash = "#/rooms"));
    q("#rm-end")?.addEventListener("click", async () => { if (!confirm("إنهاء الغرفة للجميع؟")) return; if (RTC.rec) await stopRecording(true); await api("POST", `/api/rooms/${RTC.room}/end`); await leaveRoom(true); location.hash = "#/rooms"; });
    q("#rm-rec")?.addEventListener("click", () => RTC.rec ? stopRecording(false) : startRecording());
    q("#rm-tip")?.addEventListener("click", (e) => roomTip(s, e.currentTarget));
    view.querySelectorAll("[data-promote]").forEach(b => b.onclick = () => api("POST", `/api/rooms/${RTC.room}/role`, { user: b.dataset.promote, role: "speaker" }).catch(e => toast(e.message)));
    view.querySelectorAll("[data-demote]").forEach(b => b.onclick = () => api("POST", `/api/rooms/${RTC.room}/role`, { user: b.dataset.demote, role: "listener" }));
  }
  /* v2.75 live-room tips («إكرامية في البث»): MJT to the host while the room is live (POST /api/mjt/rooms/:id/tips — the
   * same guards and limits as clip tips and transfers). Everyone in the room sees a short cheer (SSE "room_tip"). Pi stays
   * visible and locked. One idempotency key per open sheet; a refused tip gets a fresh key. */
  const RT_PRESETS = [5, 10, 25, 50];
  const rtKey = () => "rt" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  function roomTip(st, ret) {
    const hostM = st.members.find((m) => m.role === "host") || {}; let amt = 10, key = rtKey(), busy = false;
    const s = sheet(`<div class="rt-sheet" role="dialog" aria-modal="true" aria-labelledby="rt-t">
      <h3 id="rt-t" tabindex="-1">إكرامية للمضيف</h3><p class="muted">ادعم <bdi>${esc(hostM.name || "")}</bdi> بمجتمع كوين أثناء البث</p>
      <div class="rt-amts" role="group" aria-label="اختر مبلغ الإكرامية">${RT_PRESETS.map((v) => `<button type="button" class="chip rt-chip" data-rt-amt="${v}" aria-pressed="${v === amt}"><span data-noi18n dir="ltr">${v} MJT</span></button>`).join("")}</div>
      <label class="rt-field"><span>مبلغ آخر</span><input type="text" inputmode="decimal" autocomplete="off" maxlength="9" dir="ltr" data-rt-custom placeholder="15"></label>
      <label class="rt-check"><input type="checkbox" data-rt-anon> <span>أرسلها دون إظهار اسمي</span></label>
      <p class="muted rt-bal">رصيدك <b data-noi18n dir="ltr" data-rt-bal>…</b> · <span>Pi غير مفعّل بعد</span></p>
      <p class="rt-err" role="alert" data-rt-err></p>
      <div class="rt-actions"><button type="button" class="btn" data-rt-send>أرسل <span data-noi18n dir="ltr" data-rt-sendamt>10 MJT</span></button><button type="button" class="btn ghost" data-rt-close>إلغاء</button></div></div>`);
    const q = (x) => s.querySelector(x), err = (m) => { q("[data-rt-err]").textContent = m || ""; };
    const setAmt = (v) => { amt = v; q("[data-rt-sendamt]").textContent = `${v} MJT`; s.querySelectorAll("[data-rt-amt]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.rtAmt === v))); };
    s._onclose = () => { if (ret?.isConnected) ret.focus(); };
    setTimeout(() => q("#rt-t")?.focus(), 30);
    api("GET", "/api/mjt/me").then((r) => { const b = q("[data-rt-bal]"); if (b) b.textContent = `${r.balance?.mjt ?? "0"} MJT`; }).catch(() => { });
    s.querySelectorAll("[data-rt-amt]").forEach((b) => b.addEventListener("click", () => { q("[data-rt-custom]").value = ""; err(); setAmt(+b.dataset.rtAmt); }));
    q("[data-rt-custom]").addEventListener("input", (e) => { const v = Number(String(e.target.value).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(",", ".")); err(); if (v > 0) setAmt(Math.round(v * 100) / 100); });
    q("[data-rt-close]").addEventListener("click", () => closeSheet());
    q("[data-rt-send]").addEventListener("click", async (e) => {
      if (busy) return; busy = true; const btn = e.currentTarget; btn.disabled = true; err();
      try {
        await api("POST", `/api/mjt/rooms/${encodeURIComponent(st.room.id)}/tips`, { ikey: key, amount: String(amt), anon: !!q("[data-rt-anon]").checked });
        closeSheet(); toast("وصلت إكراميتك");
      } catch (x) { err(x.message || "تعذّر الإرسال"); key = rtKey(); btn.disabled = false; busy = false; }
    });
  }
  const ANON_HTML = "<span>داعم مجهول</span>";
  function roomCheer(c) {
    const host = view.querySelector(".room"); if (!host || !c) return;
    const el = document.createElement("div"); el.className = "rt-cheer"; el.setAttribute("role", "status");
    el.innerHTML = `${ic("coin", "sm")} ${c.from ? `<span><bdi>${esc(c.from.name || "")}</bdi></span>` : ANON_HTML} <b data-noi18n dir="ltr">+${esc(String(c.amount))} MJT</b>`;
    host.appendChild(el); setTimeout(() => el.remove(), 4200);
  }
  /* WebRTC mesh: every speaker sends audio to every member; signalling relayed by the server */
  async function syncMedia() {
    const s = RTC.state; if (!s || s.room.status !== "live") return;
    const me = s.members.find(m => m.id === DB.me); if (!me) return;
    if (RTC.mode === "livekit") return; // LiveKit client SDK plugs in here; token already minted
    const speaking = me.role !== "listener";
    if (speaking && !RTC.local) { try { RTC.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); RTC.local.getAudioTracks().forEach(t => t.enabled = !me.muted); meter(DB.me, RTC.local); } catch { toast("لا يمكن الوصول إلى الميكروفون"); } }
    if (!speaking && RTC.local) { RTC.local.getTracks().forEach(t => t.stop()); RTC.local = null; for (const [, pc] of RTC.pcs) pc.close(); RTC.pcs.clear(); }
    const ids = new Set(s.members.map(m => m.id));
    for (const [peer, pc] of RTC.pcs) if (!ids.has(peer)) { pc.close(); RTC.pcs.delete(peer); RTC.audios.get(peer)?.remove(); RTC.audios.delete(peer); }
    if (speaking && RTC.local) for (const m of s.members) if (m.id !== DB.me && !RTC.pcs.has(m.id)) await offer(m.id);
  }
  function pcFor(peer) {
    let pc = RTC.pcs.get(peer); if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: RTC.ice }); RTC.pcs.set(peer, pc);
    pc.onicecandidate = (e) => e.candidate && api("POST", `/api/rooms/${RTC.room}/signal`, { to: peer, data: { ice: e.candidate } }).catch(() => { });
    pc.ontrack = (e) => { let a = RTC.audios.get(peer); if (!a) { a = new Audio(); a.autoplay = true; RTC.audios.set(peer, a); document.body.appendChild(a); a.hidden = true; } a.srcObject = e.streams[0]; meter(peer, e.streams[0]); };
    pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) { RTC.pcs.delete(peer); } };
    return pc;
  }
  async function offer(peer) { const pc = pcFor(peer); RTC.local.getTracks().forEach(t => pc.addTrack(t, RTC.local)); const o = await pc.createOffer({ offerToReceiveAudio: true }); await pc.setLocalDescription(o); await api("POST", `/api/rooms/${RTC.room}/signal`, { to: peer, data: { sdp: pc.localDescription } }).catch(() => { }); }
  async function onSignal({ room, from, data }) {
    if (room !== RTC.room) return; const pc = pcFor(from);
    if (data.sdp) { await pc.setRemoteDescription(data.sdp); if (data.sdp.type === "offer") { if (RTC.local && !pc.getSenders().length) RTC.local.getTracks().forEach(t => pc.addTrack(t, RTC.local)); await pc.setLocalDescription(await pc.createAnswer()); await api("POST", `/api/rooms/${RTC.room}/signal`, { to: from, data: { sdp: pc.localDescription } }).catch(() => { }); } }
    if (data.ice) await pc.addIceCandidate(data.ice).catch(() => { });
  }
  /* speaking indicator: analyser per stream */
  let actx = null;
  function meter(uid, stream) {
    try { actx ||= new AudioContext(); const src = actx.createMediaStreamSource(stream), an = actx.createAnalyser(); an.fftSize = 256; src.connect(an); RTC.analysers.set(uid, an); } catch { return; }
    if (RTC.raf) return; const buf = new Uint8Array(128);
    const loop = () => { RTC.raf = requestAnimationFrame(loop); for (const [u, an] of RTC.analysers) { an.getByteFrequencyData(buf); const lvl = buf.reduce((a, b) => a + b, 0) / buf.length; document.querySelector(`[data-spk="${u}"]`)?.classList.toggle("speaking", lvl > 18); } };
    loop();
  }
  /* host recording: mix local + remote audio, record, publish as an episode */
  function startRecording() {
    try {
      actx ||= new AudioContext(); const dest = actx.createMediaStreamDestination();
      [RTC.local, ...[...RTC.audios.values()].map(a => a.srcObject)].filter(Boolean).forEach(st => actx.createMediaStreamSource(st).connect(dest));
      const mr = new MediaRecorder(dest.stream); const chunks = []; mr.ondataavailable = (e) => e.data.size && chunks.push(e.data); mr.start(2000);
      RTC.rec = { mr, chunks, at: Date.now() }; toast("⏺ بدأ التسجيل"); renderRoom();
    } catch { toast("التسجيل غير مدعوم في هذا المتصفح"); }
  }
  async function stopRecording(publish) {
    const r = RTC.rec; if (!r) return; RTC.rec = null;
    await new Promise(res => { r.mr.onstop = res; r.mr.stop(); });
    const blob = new Blob(r.chunks, { type: r.mr.mimeType || "audio/webm" });
    if (publish || confirm("نشر التسجيل كحلقة صوتية؟")) {
      try { const m = (await api("POST", "/api/media?kind=audio", null, blob)).media; await api("POST", "/api/posts", { id: rid("p"), type: "audio", text: "🎙 حلقة: " + (RTC.state?.room.title || ""), audio: { mediaId: m.id, room: RTC.room } }); toast("✓ يُجهَّز التسجيل وسيُنشر كحلقة"); } catch (e) { toast(e.message); }
    }
    renderRoom();
  }
  async function leaveRoom(silent) {
    if (!RTC.room) return; const id = RTC.room; RTC.room = null;
    for (const [, pc] of RTC.pcs) pc.close(); RTC.pcs.clear(); RTC.local?.getTracks().forEach(t => t.stop()); RTC.local = null;
    for (const [, a] of RTC.audios) a.remove(); RTC.audios.clear(); RTC.analysers.clear(); cancelAnimationFrame(RTC.raf); RTC.raf = 0;
    if (!silent) await api("POST", `/api/rooms/${id}/leave`).catch(() => { });
  }
  window.__rtcStates = () => [...RTC.pcs.values()].map(pc => pc.connectionState);
  window.addEventListener("beforeunload", () => { if (RTC.room) navigator.sendBeacon?.(`/api/rooms/${RTC.room}/leave`); });

  /* =================== Creator Studio =================== */
  const spark = (vals, h = 80, color = "var(--accent)") => { const w = 300, max = Math.max(1, ...vals); const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${h - 6 - (v / max) * (h - 14)}`).join(" "); return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,${h} ${pts} ${w},${h}" fill="color-mix(in srgb, ${color} 14%, transparent)" stroke="none"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`; };
  const deltaTag = (d) => `<span class="delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "▲" : d < 0 ? "▼" : "•"} ${Math.abs(d)}٪</span>`;
  async function studioView() {
    const tab = view._stab || "overview";
    const TABS = [["overview", "نظرة عامة"], ["calendar", "التقويم"], ["best", "أفضل وقت"], ["recycle", "إعادة النشر"], ["templates", "القوالب"], ["weekly", "التقرير الأسبوعي"]];
    view.innerHTML = `<div class="wrap studio"><header class="page-head row-head"><div class="ph-main"><div><h2>${ic("chart")}استوديو المنشئ</h2></div><div class="acts"><a class="btn outline sm" href="#/analytics">تحليلات متقدمة</a><button class="btn sm" data-ui="compose">${ic("pen", "xs")} إنشاء</button></div></div></header><div class="explore-shortcuts"><a href="#/scheduled">${ic("clock", "sm")}المجدولة</a><a href="#/drafts">${ic("doc", "sm")}المسودات</a><a href="#/series">${ic("book", "sm")}السلاسل</a></div><div class="seg">${TABS.map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-stab="${k}">${l}</button>`).join("")}</div><div id="st-body"><div class="skel"></div><div class="skel"></div></div></div>`;
    view.querySelectorAll("[data-stab]").forEach(b => b.onclick = () => { view._stab = b.dataset.stab; studioView(); });
    if (online()) startGuideMount(); // v2.61 «ابدأ هنا» (own section below)
    if (online()) goalsMount(); // v2.61 goals + «روابطك» (own section, below «ابدأ هنا»)
    if (!online()) { $("#st-body").innerHTML = `<div class="empty">الاستوديو يتطلب الاتصال</div>`; return; }
    const body = $("#st-body");
    try { await ({ overview: stOverview, calendar: stCalendar, best: stBest, recycle: stRecycle, templates: stTemplates, weekly: stWeekly })[tab](body); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  async function stOverview(body) {
    const days = view._sdays || 28, o = await api("GET", "/api/studio/overview?days=" + days);
    const kpi = (label, v, d, series) => `<div class="kpi-card"><span class="muted">${label}</span><b>${fmtN(v)}</b>${d !== undefined ? deltaTag(d) : ""}${series ? spark(series.map(x => x.value), 46) : ""}</div>`;
    body.innerHTML = `<div class="u-m0 u-mt6 u-mb10 chips">${[7, 28, 90].map(d => `<button class="tab ${d === days ? "on" : ""}" data-days="${d}">${d} يوماً</button>`).join("")}</div>
      <div class="kpi-grid">${kpi("المشاهدات", o.totals.views, o.deltas.views, o.daily.views)}${kpi("الوصول (أشخاص)", o.totals.reach, o.deltas.reach)}${kpi("التفاعل", o.totals.engagement, o.deltas.engagement, o.daily.engagement)}${kpi("متابعون جدد", o.totals.followers, o.deltas.followers, o.daily.followers)}</div>
      <div class="card"><div class="row"><b class="grow">المشاهدات يومياً</b><span class="muted">معدل التفاعل ${o.engagementRate}٪</span></div>${spark(o.daily.views.map(x => x.value), 140)}<div class="u-t-xs row muted"><span>${o.daily.views[0].day}</span><span class="grow"></span><span>${o.daily.views[o.daily.views.length - 1].day}</span></div></div>
      <div class="card"><b>مصادر الزيارات</b>${o.sources.map(s => `<div class="src-row"><span>${esc(s.label)}</span><div class="fn-bar"><i style="width:${s.share}%"></i></div><b>${s.share}٪</b></div>`).join("") || '<p class="muted">لا زيارات مسجلة بعد</p>'}</div>
      <h4>أفضل منشوراتك</h4>${o.top.map(p => `<button class="card row top-post" data-ps="${p.id}"><div class="u-ts grow"><b>${esc(p.title)}</b><div class="muted">${relTime(p.at)}</div></div><span class="muted">${ic("eye", "xs")} ${fmtN(p.views)} · ${ic("heart", "xs")} ${p.reactions} · ${ic("comment", "xs")} ${p.comments}</span></button>`).join("") || '<div class="empty">انشر لترى إحصائياتك هنا</div>'}`;
    body.querySelectorAll("[data-days]").forEach(b => b.onclick = () => { view._sdays = +b.dataset.days; studioView(); });
    body.querySelectorAll("[data-ps]").forEach(b => b.onclick = () => postStatsSheet(b.dataset.ps));
  }
  async function postStatsSheet(id) {
    const s = await api("GET", "/api/studio/posts/" + id);
    const RX = { like: "إعجاب", support: "دعم", haha: "ضحك", useful: "مفيد" };
    sheet(`<h4 class="u-mt0">${ic("chart", "sm")} ${esc(s.post.title)}</h4><div class="kpi-grid small">${[["مشاهدات", s.views], ["وصول", s.reach], ["تعليقات", s.comments], ["مشاركات", s.shares]].map(([l, v]) => `<div class="kpi-card"><span class="muted">${l}</span><b>${fmtN(v)}</b></div>`).join("")}</div>
      <p class="muted">معدل التفاعل ${s.engagementRate}٪ · ${Object.entries(s.reactions).map(([k, v]) => `<span>${RX[k] || k} ${v}</span>`).join(" · ") || "لا تفاعلات"}</p>
      <b>أول ٤٨ ساعة</b>${spark(s.first48h, 90)}<b>المصادر</b>${s.sources.map(x => `<div class="src-row"><span>${esc(x.label)}</span><div class="fn-bar"><i style="width:${x.share}%"></i></div><b>${x.share}٪</b></div>`).join("") || '<p class="muted">لا بيانات بعد</p>'}`);
  }
  async function stCalendar(body) {
    const month = view._smonth || new Date().toISOString().slice(0, 7), c = await api("GET", "/api/studio/calendar?month=" + month);
    const [y, m] = month.split("-").map(Number), first = new Date(y, m - 1, 1), daysIn = new Date(y, m, 0).getDate(), lead = first.getDay();
    const byDay = {}; for (const it of c.items) { const d = new Date(it.at).getDate(); (byDay[d] ||= []).push(it); }
    const shift = (k) => { const d = new Date(y, m - 1 + k, 1); view._smonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; studioView(); };
    body.innerHTML = `<div class="row cal-head"><button class="btn ghost" id="cal-prev" aria-label="الشهر السابق">→</button><b class="u-tc grow">${first.toLocaleDateString(lcl(), { month: "long", year: "numeric" })}</b><button class="btn ghost" id="cal-next" aria-label="الشهر التالي">←</button></div>
      <div class="cal">${DAYS.map((d, i) => `<div class="cal-dow">${dow3(i)}</div>`).join("")}${Array.from({ length: lead }, () => `<div></div>`).join("")}${Array.from({ length: daysIn }, (_, i) => { const d = i + 1, items = byDay[d] || [], today = new Date().toDateString() === new Date(y, m - 1, d).toDateString(); return `<div class="cal-day ${today ? "today" : ""}" data-day="${d}"><span class="cal-n">${d}</span>${items.slice(0, 3).map(it => `<button type="button" class="cal-item ${it.status}" draggable="${it.status === "scheduled"}" data-item="${it.id}" title="${esc(it.title)}" aria-label="${esc(it.title)} · ${it.status === "scheduled" ? "مجدول" : "منشور"} ${esc(fmtAt(it.at))}">${it.status === "scheduled" ? ic("refresh", "xs") : ""}<bdi>${esc(it.title.slice(0, 14))}</bdi></button>`).join("")}${items.length > 3 ? `<button type="button" class="cal-more" data-more="${d}" aria-label="كل منشورات اليوم ${d}">+${items.length - 3}</button>` : ""}</div>`; }).join("")}</div>
      <p class="muted cal-hint">${ic("refresh", "xs")} <span>اضغط منشوراً مجدولاً لتغيير موعده، أو اسحبه إلى يوم آخر على الحاسوب. اضغط يوماً لجدولة منشور فيه.</span></p>`;
    $("#cal-prev").onclick = () => shift(-1); $("#cal-next").onclick = () => shift(1);
    let dragId = null;
    const open = (id, ret) => { const it = c.items.find(x => x.id === id); if (!it) return; if (it.status === "scheduled") scheduledSheet(it, ret); else postStatsSheet(id); };
    body.querySelectorAll('.cal-item[draggable="true"]').forEach(it => { it.addEventListener("dragstart", (e) => { dragId = it.dataset.item; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); it.classList.add("dragging"); }); it.addEventListener("dragend", () => { it.classList.remove("dragging"); dragId = null; body.querySelectorAll(".cal-day.over").forEach(x => x.classList.remove("over")); }); it.addEventListener("click", (e) => { e.stopPropagation(); open(it.dataset.item, it); }); });
    body.querySelectorAll(".cal-item.published").forEach(it => it.addEventListener("click", (e) => { e.stopPropagation(); postStatsSheet(it.dataset.item); }));
    // v2.61 (touch): «+N» and, on touch screens, a tap on a day that has posts open that day's list (rows ≥ 48 px) instead of tiny chips
    const coarse = () => !!window.matchMedia?.("(pointer: coarse)").matches;
    body.querySelectorAll(".cal-more").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); daySheet(new Date(y, m - 1, +b.dataset.more), byDay[+b.dataset.more] || [], open, b); }));
    body.querySelectorAll(".cal-day").forEach(d => {
      d.addEventListener("dragover", (e) => { e.preventDefault(); d.classList.add("over"); }); d.addEventListener("dragleave", () => d.classList.remove("over"));
      d.addEventListener("drop", async (e) => { e.preventDefault(); d.classList.remove("over"); const it = c.items.find(x => x.id === (dragId || e.dataTransfer.getData("text/plain"))); dragId = null; if (!it || it.status !== "scheduled") return; const old = new Date(it.at), nd = new Date(y, m - 1, +d.dataset.day, old.getHours(), old.getMinutes()); if (nd.toDateString() === old.toDateString()) return; if (nd.getTime() < Date.now() + 5 * 60e3) return toast("اختر يوماً قادماً"); /* v2.80: same day = nothing to do; a past day is refused here instead of a server error; dragId never goes stale */ try { await api("PATCH", "/api/studio/schedule/" + it.id, { publishAt: nd.toISOString() }); toast("✓ أُعيدت الجدولة"); studioView(); } catch (er) { toast(er.message); } });
      d.addEventListener("click", () => { if (coarse() && (byDay[+d.dataset.day] || []).length) return daySheet(new Date(y, m - 1, +d.dataset.day), byDay[+d.dataset.day], open, d); const at = new Date(y, m - 1, +d.dataset.day, 20, 0); if (at < new Date()) return toast("اختر يوماً قادماً"); composer({ data: { publishAt: new Date(at - at.getTimezoneOffset() * 60e3).toISOString().slice(0, 16) } }); });
    });
  }
  /* v2.61 — touch-first rescheduling. HTML5 drag never fires on phones, so a tap on a scheduled post opens the unified action
   * sheet (.as, community chunk styles — warmed after sign-in) with «تغيير الموعد» → native date + time pickers and quick
   * chips (بعد ساعة · الليلة 9م · غداً 9ص). Desktop drag-to-day is unchanged. Server: PATCH /api/studio/schedule/:id. */
  const lang = lcl; // v2.61 i18n: sheet dates follow the UI language (Arabic output unchanged)
  const fmtAt = (at) => new Date(at).toLocaleString(lang(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function quickTimes(now = new Date()) { // the three chips; «الليلة» only while 9 pm is still ahead
    const h = new Date(now.getTime() + 60 * 60e3); h.setSeconds(0, 0); h.setMinutes(Math.ceil(h.getMinutes() / 5) * 5);
    const t = new Date(now); t.setHours(21, 0, 0, 0); const tm = new Date(now); tm.setDate(tm.getDate() + 1); tm.setHours(9, 0, 0, 0);
    const tr = (x) => (window.MPI18n?.t ? window.MPI18n.t(x) : x); // v2.67 i18n: chip labels follow the UI language even before the DOM translator runs
    return [["hour", tr("بعد ساعة"), h], ["tonight", tr("الليلة 9م"), t > new Date(now.getTime() + 2 * 60e3) ? t : null], ["tomorrow", tr("غداً 9ص"), tm]];
  }
  const ready = () => (window.MPChunks?.load ? window.MPChunks.load("communities").catch(() => { }) : Promise.resolve());
  function asSheet(html, ret, label) {
    const s = sheet(`<div class="as st-rs">${html}</div>`), pnl = s.querySelector(".panel");
    pnl?.setAttribute("role", "dialog"); pnl?.setAttribute("aria-modal", "true"); pnl?.setAttribute("aria-labelledby", label);
    s._onclose = () => { if (ret?.isConnected) ret.focus(); };
    s.querySelector(".as").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeSheet(); } });
    return s;
  }
  async function daySheet(day, items, open, ret) {
    await ready();
    asSheet(`<div class="as-h"><span class="as-ic" aria-hidden="true">${ic("clock", "sm")}</span><h3 class="u-m0" id="st-day-t">${esc(day.toLocaleDateString(lang(), { weekday: "long", day: "numeric", month: "long" }))}</h3></div>
      <div class="st-rs-list">${items.map(it => `<button type="button" class="st-rs-row" data-open="${it.id}"><span class="sbadge ${it.status === "scheduled" ? "" : "ok"}">${it.status === "scheduled" ? "مجدول" : "منشور"}</span><bdi class="grow">${esc(it.title)}</bdi><small class="muted">${esc(new Date(it.at).toLocaleTimeString(lang(), { hour: "numeric", minute: "2-digit" }))}</small></button>`).join("")}</div>
      <div class="as-acts"><button type="button" class="btn grow" id="st-day-new">${ic("plus", "xs")} منشور جديد في هذا اليوم</button><button type="button" class="btn ghost grow" id="st-day-x">إغلاق</button></div>`, ret, "st-day-t");
    document.querySelectorAll("#sheet [data-open]").forEach(b => (b.onclick = () => open(b.dataset.open, ret)));
    $("#st-day-x").onclick = () => closeSheet();
    $("#st-day-new").onclick = () => { const at = new Date(day); at.setHours(20, 0, 0, 0); if (at < new Date()) return toast("اختر يوماً قادماً"); closeSheet(); composer({ data: { publishAt: `${ymd(at)}T${hm(at)}` } }); };
    setTimeout(() => document.querySelector("#sheet .st-rs-row")?.focus(), 40);
  }
  async function scheduledSheet(it, ret) {
    await ready();
    asSheet(`<div class="as-h"><span class="as-ic" aria-hidden="true">${ic("clock", "sm")}</span><h3 class="u-m0" id="rs-title"><bdi>${esc(it.title)}</bdi></h3></div>
      <p class="as-t"><span>مجدول للنشر:</span> <b>${esc(fmtAt(it.at))}</b></p>
      <div class="st-rs-acts"><button type="button" class="btn block" id="rs-change">${ic("clock", "xs")} تغيير الموعد</button><button type="button" class="btn ghost block" id="rs-now">${ic("arrowUp", "xs")} انشر الآن</button><button type="button" class="btn ghost block" id="rs-x">إغلاق</button></div>`, ret, "rs-title");
    $("#rs-change").onclick = () => rescheduleSheet(it, ret);
    $("#rs-x").onclick = () => closeSheet();
    $("#rs-now").onclick = async () => { try { await api("POST", `/api/studio/schedule/${it.id}/now`); closeSheet(); toast("✓ نُشر"); if (typeof refresh === "function") refresh(); studioView(); } catch (e) { toast(e.message); } };
    setTimeout(() => $("#rs-change")?.focus(), 40);
  }
  function rescheduleSheet(it, ret) {
    const cur = new Date(it.at), today = new Date();
    asSheet(`<div class="as-h"><span class="as-ic" aria-hidden="true">${ic("clock", "sm")}</span><h3 class="u-m0" id="rs-t2">تغيير الموعد</h3></div>
      <p class="as-t"><bdi>${esc(it.title)}</bdi></p>
      <div class="as-mac"><span class="lbl" id="rs-q-l">مواعيد سريعة</span><div class="as-chips" role="group" aria-labelledby="rs-q-l">${quickTimes().map(([k, l, d]) => `<button type="button" class="as-m" data-q="${k}" ${d ? `data-at="${d.toISOString()}"` : 'disabled aria-disabled="true"'} aria-pressed="false">${l}</button>`).join("")}</div></div>
      <div class="st-rs-pick"><label class="field"><span class="lbl">التاريخ</span><input type="date" id="rs-d" value="${ymd(cur)}" min="${ymd(today)}" required></label><label class="field"><span class="lbl">الوقت</span><input type="time" id="rs-tm" value="${hm(cur)}" step="300" required></label></div>
      <p class="as-t" id="rs-prev" aria-live="polite"></p><small class="st-rs-err" id="rs-err" role="alert"></small>
      <div class="as-acts"><button type="button" class="btn grow" id="rs-save">حفظ الموعد</button><button type="button" class="btn ghost grow" id="rs-back">رجوع</button></div>`, ret, "rs-t2");
    const D = $("#rs-d"), T = $("#rs-tm"), prev = $("#rs-prev"), err = $("#rs-err"), save = $("#rs-save"); if (window.MPI18n?.t) { const st = MPI18n.t("حفظ الموعد"); if (st) save.textContent = st; }
    const at = () => { if (!D.value || !T.value) return null; const [a, b, c2] = D.value.split("-").map(Number), [h, mi] = T.value.split(":").map(Number); return new Date(a, b - 1, c2, h, mi); };
    const check = () => { const v = at(), ok = !!v && v > new Date(Date.now() + 60e3); prev.innerHTML = v ? `<span>الموعد الجديد:</span> <b>${esc(fmtAt(v))}</b>` : ""; err.textContent = v && !ok ? "اختر موعداً في المستقبل" : ""; save.disabled = !ok; return ok ? v : null; };
    const chips = document.querySelectorAll("#sheet .as-m[data-at]");
    chips.forEach(b => (b.onclick = () => { const d = new Date(b.dataset.at); D.value = ymd(d); T.value = hm(d); chips.forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }); check(); save.focus(); }));
    [D, T].forEach(i => i.addEventListener("input", () => { chips.forEach(x => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); }); check(); }));
    $("#rs-back").onclick = () => scheduledSheet(it, ret);
    save.onclick = async () => { const v = check(); if (!v) return; save.disabled = true; try { await api("PATCH", "/api/studio/schedule/" + it.id, { publishAt: v.toISOString() }); closeSheet(); toast("✓ أُعيدت الجدولة"); studioView(); } catch (e) { err.textContent = e.message; save.disabled = false; } };
    check(); setTimeout(() => document.querySelector("#sheet .as-m:not([disabled])")?.focus(), 40);
  }
  async function stBest(body) {
    const r = await api("GET", "/api/studio/best-time?tz=" + (-new Date().getTimezoneOffset()));
    const slots = r.enough ? r.best : r.fallback;
    body.innerHTML = `<div class="card"><b>${r.enough ? "متى يكون جمهورك نشطاً؟" : "لا بيانات كافية بعد"}</b><p class="u-m0 u-mt4 u-mb10 muted">${r.enough ? `من ${r.samples} تفاعلاً لمتابعيك خلال ٦٠ يوماً، بتوقيتك المحلي.` : "نحتاج نشاطاً أكثر من متابعيك. هذه أوقات مقترحة عامة للجمهور العربي."}</p>
      <div class="best-slots">${slots.map((s, i) => `<div class="slot"><span class="muted">${["الأفضل", "الثاني", "الثالث"][i]}</span><b>${DAYS[s.day]}</b><span>${s.hour}:00</span></div>`).join("")}</div></div>
      <div class="card heat-wrap"><div class="heat" role="img" aria-label="خريطة نشاط الجمهور">${r.grid.map((row, d) => `<span class="heat-l">${dow3(d)}</span>${row.map((v, h) => `<i style="--v:${v}" title="${DAYS[d]} ${h}:00"></i>`).join("")}`).join("")}<span></span>${Array.from({ length: 24 }, (_, h) => `<span class="heat-h">${h % 6 === 0 ? h : ""}</span>`).join("")}</div></div>`;
  }
  async function stRecycle(body) {
    const { candidates } = await api("GET", "/api/studio/recycle");
    body.innerHTML = `<p class="muted">منشورات نجحت قبل أكثر من ٣٠ يوماً ولم يرها متابعوك الجدد.</p>${candidates.map(c => `<div class="card"><b>${esc(c.title)}</b><div class="muted">${relTime(c.createdAt)} · ${ic("eye", "xs")} ${fmtN(c.views)} · ${ic("heart", "xs")} ${c.reactions} · ${ic("comment", "xs")} ${c.comments}</div><div class="u-g8 u-mt10 row"><button class="btn grow" data-rc="${c.id}" data-mode="repost">${ic("repost", "xs")} إعادة نشر</button><button class="btn ghost grow" data-rc="${c.id}" data-mode="copy">${ic("copy", "xs")} نشر كمنشور جديد</button></div></div>`).join("") || '<div class="empty">لا منشورات قديمة ناجحة بعد</div>'}`;
    body.querySelectorAll("[data-rc]").forEach(b => b.onclick = async () => { try { await api("POST", "/api/studio/recycle/" + b.dataset.rc, { mode: b.dataset.mode }); toast("✓ أُعيد النشر"); if (typeof refresh === "function") refresh(); studioView(); } catch (e) { toast(e.message); } });
  }
  async function stTemplates(body) {
    const { templates } = await api("GET", "/api/templates");
    body.innerHTML = `${templates.map(t => `<div class="card row"><div class="grow"><b>${esc(t.name)}</b><div class="muted">${esc((t.data.markdown || "").slice(0, 80))}</div><div class="muted">استُخدم ${t.uses} مرة</div></div><button class="btn" data-use="${t.id}">استخدام</button></div>`).join("") || '<div class="empty">لا قوالب بعد</div>'}<button class="btn ghost block" id="tp-new">${ic("plus", "xs")} قالب جديد</button>`;
    body.querySelectorAll("[data-use]").forEach(b => b.onclick = async () => { const { template } = await api("POST", `/api/templates/${b.dataset.use}/use`); composer({ type: template.data.type, template: b.dataset.use, data: { title: template.data.title, markdown: template.data.markdown } }); });
    $("#tp-new").onclick = () => { sheet(`<h4 class="u-mt0">قالب جديد</h4><input id="tn" placeholder="اسم القالب" aria-label="الاسم"><textarea id="tb" placeholder="نص القالب… يدعم التنسيق" style="min-height:140px;margin-top:8px" aria-label="النص"></textarea><button class="btn block" id="tg">حفظ</button>`); $("#tg").onclick = async () => { try { await api("POST", "/api/templates", { name: $("#tn").value.trim(), data: { type: "post", markdown: $("#tb").value } }); closeSheet(); studioView(); } catch (e) { toast(e.message); } }; };
  }
  async function stWeekly(body) {
    const w = await api("GET", "/api/studio/weekly");
    body.innerHTML = `<canvas id="wk" width="1080" height="1350" class="wk-canvas" aria-label="بطاقة التقرير الأسبوعي"></canvas><div class="u-g8 u-mt10 row"><button class="btn grow" id="wk-share">${ic("share", "xs")} مشاركة</button><button class="btn ghost grow" id="wk-dl">تنزيل الصورة</button></div>`;
    drawWeekly($("#wk"), w);
    const blob = () => new Promise(r => $("#wk").toBlob(r, "image/png"));
    $("#wk-dl").onclick = async () => { const a = document.createElement("a"); a.href = URL.createObjectURL(await blob()); a.download = `mujtama-week-${w.range.to}.png`; a.click(); };
    $("#wk-share").onclick = async () => { const f = new File([await blob()], "week.png", { type: "image/png" }); if (navigator.canShare?.({ files: [f] })) navigator.share({ files: [f], title: "أسبوعي في مجتمع بلس" }).catch(() => { }); else $("#wk-dl").click(); };
  }
  function drawWeekly(cv, w) {
    const g = cv.getContext("2d"), W = cv.width, H = cv.height;
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#4c1fd1"); bg.addColorStop(1, "#d6458f"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,.08)"; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(W * (0.1 + i * 0.18), H * (0.15 + (i % 2) * 0.7), 120 + i * 20, 0, 7); g.fill(); }
    g.direction = "rtl"; g.textAlign = "right"; g.fillStyle = "#fff"; const F = (s, w8 = 700) => `${w8} ${s}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
    g.font = F(40, 600); g.globalAlpha = .85; g.fillText("مجتمع بلس · تقريري الأسبوعي", W - 80, 120); g.globalAlpha = 1;
    g.font = F(72); g.fillText(w.user.name, W - 80, 220); g.font = F(36, 500); g.globalAlpha = .8; g.fillText(`${w.range.from}  —  ${w.range.to}`, W - 80, 280); g.globalAlpha = 1;
    const cards = [["المشاهدات", w.totals.views, w.deltas.views], ["الوصول", w.totals.reach, w.deltas.reach], ["التفاعل", w.totals.engagement, w.deltas.engagement], ["متابعون جدد", w.totals.followers, w.deltas.followers]];
    cards.forEach(([l, v, d], i) => { const x = i % 2 ? 80 : W / 2 + 20, y = 360 + Math.floor(i / 2) * 250, cw = W / 2 - 100; g.fillStyle = "rgba(255,255,255,.14)"; g.beginPath(); g.roundRect(x, y, cw, 210, 36); g.fill(); g.fillStyle = "#fff"; g.font = F(34, 500); g.fillText(l, x + cw - 40, y + 70); g.font = F(84); g.fillText(fmtN(v), x + cw - 40, y + 160); g.font = F(32, 600); g.fillStyle = d >= 0 ? "#b9ffd9" : "#ffd1d1"; g.textAlign = "left"; g.fillText(`${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}٪`, x + 36, y + 160); g.textAlign = "right"; g.fillStyle = "#fff"; });
    const max = Math.max(1, ...w.daily.map(x => x.value)), bx = 80, bw = W - 160, by = 1150, bh = 180;
    w.daily.forEach((dd, i) => { const h = Math.max(8, dd.value / max * bh), x = bx + bw - (i + 1) * (bw / 7) + 18; g.fillStyle = "rgba(255,255,255,.85)"; g.beginPath(); g.roundRect(x, by - h, bw / 7 - 36, h, 14); g.fill(); g.font = F(26, 500); g.textAlign = "center"; g.fillText(DAYS[new Date(dd.day).getDay()].slice(0, 3), x + (bw / 7 - 36) / 2, by + 44); g.textAlign = "right"; });
    g.font = F(34, 600); g.fillText(w.topPost ? `الأبرز: ${w.topPost.title.slice(0, 34)}` : "انشر هذا الأسبوع لتظهر هنا", W - 80, 940); g.font = F(30, 500); g.globalAlpha = .85; g.fillText(`معدل التفاعل ${w.engagementRate}٪${w.bestDay ? ` · أفضل يوم: ${DAYS[new Date(w.bestDay).getDay()]}` : ""}`, W - 80, 995); g.globalAlpha = 1;
  }

  /* realtime: room state + WebRTC signalling (hooked on the current stream and on every reconnect) */
  const hook = () => { const es = typeof Remote !== "undefined" && Remote.es; if (!es || es.__rtcHooked) return; es.__rtcHooked = 1;
    es.addEventListener("room", (e) => { const s = JSON.parse(e.data); if (s.room?.id === RTC.room) { RTC.state = s; renderRoom(); syncMedia(); if (s.room.status !== "live") leaveRoom(true); } });
    es.addEventListener("rtc", (e) => onSignal(JSON.parse(e.data)).catch(() => { }));
    es.addEventListener("room_tip", (e) => { try { const c = JSON.parse(e.data); if (c.room === RTC.room) roomCheer(c); } catch { } }); };
  if (typeof connectStream === "function") { const _cs = connectStream; connectStream = function () { _cs.apply(this, arguments); try { hook(); } catch { } }; }
  try { hook(); } catch { }
  const _route = route;
  route = function () { const r = (location.hash.split("/")[1] || "").split("?")[0]; if (r !== "room" && RTC.room) leaveRoom(); return _route.apply(this, arguments); };
  /* =================== Studio start guide «ابدأ هنا» (v2.61, studio-start-guide) ===================
   * Compact checklist for new creators, computed from existing data (own profile, posts, scheduled posts, memberships,
   * GET /api/me/creator) + up to 3 tips from the creator's own stats (best time, engagement trend, top post).
   * Progress + dismissal kept per account in localStorage ("mp.studioStart.<uid>"); finished steps stay finished.
   * Kept in its own section (other agents extend stOverview); mounts into #st-start right under the page head. */
  const SG_KEY = () => "mp.studioStart." + (DB.me || "anon");
  const sgLoad = () => { try { return JSON.parse(localStorage.getItem(SG_KEY())) || {}; } catch { return {}; } };
  const sgSave = (st) => { try { localStorage.setItem(SG_KEY(), JSON.stringify(st)); } catch { /* private mode */ } };
  const sgNextSlot = (day, hour) => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(hour); let k = (day - d.getDay() + 7) % 7; if (k === 0 && d <= new Date()) k = 7; d.setDate(d.getDate() + k); return d; };
  const sgLocalIso = (d) => new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  async function sgData() {
    const c = view._sgCache; if (c && Date.now() - c.t < 60e3) return c.p;
    const month = new Date().toISOString().slice(0, 7), q = (u) => api("GET", u).catch(() => null);
    const p = Promise.all([q("/api/me/creator"), q("/api/studio/calendar?month=" + month), q("/api/studio/best-time?tz=" + (-new Date().getTimezoneOffset())), q("/api/studio/overview?days=28"), typeof PiAdapter !== "undefined" ? PiAdapter.config().catch(() => ({ enabled: false })) : Promise.resolve({ enabled: false })])
      .then(([creator, cal, best, ov, pi]) => ({ creator, cal, best, ov, pi }));
    view._sgCache = { t: Date.now(), p }; return p;
  }
  function sgSteps(d, st) {
    const me = S.me() || {}, mine = (DB.posts || []).filter(p => p.author === DB.me), items = (d.cal && d.cal.items) || [];
    const raw = [
      ["profile", !!(me.bio && String(me.bio).trim() && me.avatar), { href: "#/me", icon: "user", title: "أكمل ملفك الشخصي", sub: "صورة ونبذة قصيرة من «تعديل الملف» تعرّف الناس بك" }],
      ["post", mine.some(p => p.status === "published") || items.some(i => i.status === "published") || !!(d.ov && d.ov.top && d.ov.top.length), { attrs: 'data-ui="compose"', icon: "pen", title: "انشر أول منشور", sub: "ابدأ بتعريف بسيط بنفسك أو بما تقدّمه" }],
      ["schedule", mine.some(p => p.status === "scheduled") || items.some(i => i.status === "scheduled"), { attrs: 'data-sg="schedule"', icon: "clock", title: "جدول منشوراً", sub: "اختر موعداً قادماً وسيُنشر تلقائياً" }],
      ["community", (DB.memberships || []).some(m => m.user === DB.me && m.role !== "pending"), { href: "#/communities", icon: "community", title: "انضم إلى مجتمع أو أنشئ مجتمعك", sub: "المجتمعات أسرع طريق لجمهور يهتم بمحتواك" }],
      ["tips", !!(d.creator && d.creator.enabled), { href: "#/creator", icon: "wallet", title: "فعّل الإكراميات ودعم المتابعين", sub: "واطّلع على رصيدك في «مجتمع كوين»", pi: true }]
    ];
    let changed = false; st.done = st.done || {};
    const steps = raw.map(([k, ok, o]) => { if (ok && !st.done[k]) { st.done[k] = true; changed = true; } return { k, done: !!st.done[k], ...o }; });
    if (changed) sgSave(st);
    return steps;
  }
  /* tips: title/sub are trusted HTML built here; user content (post title) is escaped and marked data-noi18n so the
   * DOM translator never reports it as a missing UI string */
  function sgTips(d) {
    const out = [], ov = d.ov, b = d.best;
    if (b && b.enough && b.best && b.best[0]) { const s = b.best[0]; out.push({ icon: "clock", title: "أفضل وقت لجمهورك", sub: "اضغط لجدولة منشورك القادم في هذا الوقت", end: `<span class="sbadge role sg-slot"><span>${DAYS[s.day]}</span> <bdi>${s.hour}:00</bdi></span>`, attrs: `data-sg="best" data-day="${s.day}" data-hour="${s.hour}"` }); }
    if (ov && ov.totals && ov.totals.views > 0) {
      if (ov.deltas && ov.deltas.engagement < 0) out.push({ icon: "chart", title: `تراجع التفاعل ${Math.abs(ov.deltas.engagement)}٪ عن الفترة السابقة`, sub: "جرّب سؤالاً مباشراً لمتابعيك أو استطلاعاً قصيراً", attrs: 'data-ui="compose"' });
      else if (ov.engagementRate < 3) out.push({ icon: "chart", title: `معدل التفاعل ${ov.engagementRate}٪`, sub: "اختم منشوراتك بسؤال يدعو للتعليق لرفع التفاعل", attrs: 'data-ui="compose"' });
      if (ov.top && ov.top[0]) out.push({ icon: "sparkle", title: "منشورك الأنجح: أعد نشره لمتابعيك الجدد", sub: `<bdi data-noi18n>${esc(ov.top[0].title)}</bdi>`, attrs: 'data-sg="recycle"' });
    } else if (b && !b.enough && ov && ov.top && ov.top.length) out.push({ icon: "clock", title: "انشر بانتظام لنعرف أفضل وقت لجمهورك", sub: "نحتاج تفاعلات أكثر من متابعيك لتحديده بدقة" });
    return out.slice(0, 3);
  }
  const sgRow = (o) => { const tag = o.attrs ? "button" : "div"; return `<${tag} ${o.attrs ? `type="button" class="li" ${o.attrs}` : 'class="li"'}><span class="ico">${ic(o.icon, "sm")}</span><span class="t"><b>${o.title}</b><small>${o.sub}</small></span>${o.end || ""}</${tag}>`; };
  async function startGuideMount() {
    const head = view.querySelector(".studio > .page-head"); if (!head) return;
    let box = view.querySelector("#st-start");
    if (!box) { head.insertAdjacentHTML("afterend", `<section id="st-start" class="sg" aria-label="ابدأ هنا"></section>`); box = view.querySelector("#st-start"); }
    const d = await sgData(); if (!box.isConnected) return;
    const st = sgLoad(), steps = sgSteps(d, st), done = steps.filter(x => x.done).length, all = done === steps.length, tips = sgTips(d);
    const li = (o) => UI.li({ href: o.href, attrs: o.attrs || "", icon: o.icon, title: o.title, sub: o.sub, end: o.end });
    let html = "";
    if (!all && !st.dismissed) {
      const todo = steps.filter(x => !x.done), pct = Math.round(done / steps.length * 100);
      html += `<div class="card sg-card"><div class="sg-head"><div class="grow"><h3 class="sg-t" id="sg-t">${ic("target", "sm")}ابدأ هنا</h3><span class="muted sg-c">${done} من ${steps.length} خطوات</span></div><button class="btn ghost icon" id="sg-hide" aria-label="إخفاء دليل البدء" title="إخفاء">${ic("x", "sm")}</button></div>
        <div class="fn-bar sg-bar" role="progressbar" aria-labelledby="sg-t" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${done}" data-pct="${pct}"><i></i></div>
        <div class="list flat sg-list">${todo.map(o => li({ ...o, end: o.pi && !(d.pi && d.pi.enabled) ? `<span class="sbadge">غير مفعّل بعد</span>` : undefined })).join("")}</div>
        ${done ? `<details class="sg-done"><summary>${ic("check", "xs")} المكتمل (${done})</summary><ul>${steps.filter(x => x.done).map(x => `<li>${ic("okCircle", "xs")}${esc(x.title)}</li>`).join("")}</ul></details>` : ""}</div>`;
    } else if (!all) html += `<button class="btn ghost sm sg-show" id="sg-show">${ic("target", "xs")} دليل البدء · ${done}/${steps.length}</button>`;
    if (tips.length) html += `<div class="sg-tips"><h4 class="sg-th">${ic("bulb", "xs")} نصائح من أرقامك</h4><div class="list flat">${tips.map(sgRow).join("")}</div></div>`;
    box.innerHTML = html; box.hidden = !html;
    const bar = box.querySelector(".sg-bar"); if (bar) bar.firstElementChild.style.width = bar.dataset.pct + "%"; // CSSOM, no inline style attr
    box.querySelector("#sg-hide")?.addEventListener("click", async () => { st.dismissed = true; sgSave(st); await startGuideMount(); view.querySelector("#sg-show")?.focus(); });
    box.querySelector("#sg-show")?.addEventListener("click", async () => { st.dismissed = false; sgSave(st); await startGuideMount(); view.querySelector("#sg-hide")?.focus(); });
    box.querySelectorAll('[data-sg="schedule"]').forEach(b => b.addEventListener("click", () => { const at = sgNextSlot(new Date().getDay(), 20); composer({ data: { publishAt: sgLocalIso(at) } }); }));
    box.querySelectorAll('[data-sg="best"]').forEach(b => b.addEventListener("click", () => composer({ data: { publishAt: sgLocalIso(sgNextSlot(+b.dataset.day, +b.dataset.hour)) } })));
    box.querySelectorAll('[data-sg="recycle"]').forEach(b => b.addEventListener("click", () => { view._stab = "recycle"; studioView(); }));
  }

  MPRoutes.extend((a, b) => ({ studio: () => studioView(), rooms: () => roomsView(), room: () => roomView(a) }));
  window.MPStudio = { studioView, postStatsSheet, roomsView, roomView, leaveRoom, inRoom: () => !!RTC.room };
  if (!window.__deferRoute && /^#\/(studio|rooms|room)(\/|\?|$)/.test(location.hash)) route();
})();
