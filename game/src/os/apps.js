/* MJT OS programs. Mining is the first real program (a window inside the OS, live from /api/mjt/mining);
 * the other entries keep every page the old terminal offered (wallet, balance, records, stats) as launchers
 * that open the real station pages. Add a program = one register() call. */
import { register, WALLS, wallGet, wallSet, photosGet, photosSet } from "./desktop.js";
import { esc } from "../ui/ui.js";

const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const fmt = (n) => (Math.round(n * 1e4) / 1e4).toFixed(4);
const hm = (ms, t) => { const h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, s = Math.floor(ms / 1e3) % 60; return t(`${h}س ${m}د ${s}ث`, `${h}h ${m}m ${s}s`); };

register({
  id: "mining", name: ["التعدين", "Mining"], tint: "#ffc23d", pinned: true, wide: true,
  glyph: svg('<path d="M14.5 3.5l6 6-2 2-6-6z"/><path d="M12.5 5.5 4 14l6 6 8.5-8.5"/><path d="M7 17l-3.5 3.5"/>'),
  mount(body, { game, t, toast, refreshBal }) {
    let st = null, alive = true, busy = false;
    body.innerHTML = `<div class="mn">
      <div class="mn-hero"><div class="mn-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" pathLength="100"/></svg>
        <div class="mn-c"><small>MJT</small><b class="mn-n">0.0000</b><span class="mn-s"></span></div></div>
        <div class="mn-side"><p class="mn-st"></p><button type="button" class="mn-go" disabled></button><p class="mn-note"></p></div></div>
      <div class="mn-kpi"></div>
      <h4>${esc(t("آخر الدورات", "Recent cycles"))}</h4><ol class="mn-rec"></ol></div>`;
    const $ = (s) => body.querySelector(s);
    const load = () => game.host.api("GET", "/api/mjt/mining").then((m) => { st = m; paint(); }, () => { st = null; paint(); });
    function paint() {
      if (!alive) return;
      const go = $(".mn-go");
      if (!game.member) { $(".mn-st").textContent = t("سجّل الدخول لتبدأ التعدين", "Sign in to start mining"); go.hidden = true; return; }
      if (!st) { $(".mn-st").textContent = t("تعذّر الاتصال بخادم التعدين", "Couldn't reach the mining server"); go.textContent = t("إعادة المحاولة", "Retry"); go.disabled = false; go.dataset.do = "retry"; return; }
      const s = st.session;
      $(".mn-kpi").innerHTML = [[t("الرصيد", "Balance"), st.balance], [t("المعدّن كله", "Total mined"), st.totals.mined], [t("الدورات", "Cycles"), st.totals.sessions], [t("أيام متتالية", "Streak"), st.totals.streak], [t("المعدل اليومي", "Daily rate"), st.rate]]
        .map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(String(v))}</b></div>`).join("");
      $(".mn-rec").innerHTML = (st.recent || []).slice(0, 5).map((r) => `<li><b>+${esc(r.amount)}</b><time>${esc(String(r.startedAt).slice(0, 10))}</time><span>${esc(r.claimedAt ? t("مستلم", "Claimed") : t("جارٍ", "Running"))}</span></li>`).join("") || `<li class="none">${esc(t("لا دورات بعد — ابدأ أول دورة", "No cycles yet — start your first"))}</li>`;
      go.hidden = false; go.disabled = busy;
      if (!st.enabled) { $(".mn-st").textContent = t("التعدين متوقف مؤقتاً من الإدارة", "Mining is paused by the team"); go.hidden = true; }
      else if (st.frozen) { $(".mn-st").textContent = t("المحفظة مجمّدة — يستمر التعدين ويُستلم بعد فكّها", "Wallet frozen — mining continues, claim after unfreeze"); }
      if (s?.ready) { go.textContent = t("استلم الأرباح", "Claim coins"); go.dataset.do = "claim"; go.classList.add("gold"); }
      else if (s) { go.textContent = t("يعدّن الآن…", "Mining…"); go.disabled = true; go.dataset.do = ""; go.classList.remove("gold"); }
      else { go.textContent = t("ابدأ التعدين", "Start mining"); go.dataset.do = "start"; go.classList.add("gold"); }
      $(".mn-note").textContent = s ? (t("دورة ", "Cycle ") + st.sessionHours + t(" ساعة · ", "h · ") + s.amount + " MJT") : t("دورة 24 ساعة بمبلغ ثابت يُحدَّد عند البدء", "A 24-hour cycle with its amount fixed at start");
      live();
    }
    function live() {
      if (!alive || !st) return;
      const s = st.session, ring = $(".mn-ring .fg");
      let k = 0, val = 0, txt = "";
      if (s) { const a = Date.parse(s.startedAt), b = Date.parse(s.endsAt); k = Math.max(0, Math.min(1, (Date.now() - a) / (b - a))); val = Number(s.amount) * k; txt = s.ready ? t("اكتملت الدورة", "Cycle complete") : hm(b - Date.now(), t) + t(" متبقٍ", " left"); }
      $(".mn-n").textContent = fmt(val); $(".mn-s").textContent = txt; ring.style.strokeDashoffset = String(100 - k * 100); ring.style.opacity = k > 0.005 ? "1" : "0";
      body.closest(".os-win")?.classList.toggle("mining", !!s && !s.ready);
      if (!s?.ready) $(".mn-st").textContent = s ? t("الجهاز يعدّن — العدّاد يتحرك لحظياً", "Miner running — live counter") : (st.enabled ? t("الجهاز متوقف — ابدأ دورة جديدة", "Miner idle — start a new cycle") : $(".mn-st").textContent);
      else $(".mn-st").textContent = t("اكتملت الدورة — استلم أرباحك", "Cycle complete — claim your coins");
      if (s && !s.ready && Date.now() >= Date.parse(s.endsAt)) load();
    }
    const timer = setInterval(live, 1000);
    body.addEventListener("click", async (e) => {
      const b = e.target.closest(".mn-go"); if (!b || busy) return;
      const what = b.dataset.do; if (!what) return;
      if (what === "retry") { load(); return; }
      busy = true; b.disabled = true; game.audio.sfx("tap");
      try {
        const r = await game.host.api("POST", "/api/mjt/mining/" + what, {});
        if (what === "claim" && r.claimed) { game.audio.sfx("reveal"); toast(t("استلمت ", "Claimed ") + r.claimed + " MJT"); }
        else if (r.started) { game.audio.sfx("ping"); toast(t("بدأت دورة تعدين جديدة", "A new mining cycle started")); }
        st = r.state || st; refreshBal?.();
      } catch (err) { toast(err?.message || t("تعذّر تنفيذ الطلب", "Request failed")); }
      busy = false; paint();
    });
    load();
    return () => { alive = false; clearInterval(timer); };
  }
});

// ---------- wallet, balance, records: real programs on the member's live MJT data ----------
// each keeps a «الصفحة الكاملة» button to the full station page the old terminal opened (nothing removed)
const full = (ctx, id) => `<button type="button" class="ap-full" data-full="${id}">${esc(ctx.t("الصفحة الكاملة", "Full page"))} ↗</button>`;
const onFull = (body, ctx) => body.addEventListener("click", (e) => { const b = e.target.closest("[data-full]"); if (b) { ctx.close(); ctx.game.openStation(b.dataset.full); } });
const guest = (body, t) => { body.innerHTML = `<div class="ap-empty">${esc(t("سجّل الدخول لترى محفظتك", "Sign in to see your wallet"))}</div>`; };
const ago = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(document.documentElement.lang === "en" ? "en-GB" : "ar-u-nu-latn-ca-gregory", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
const ikey = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).replace(/[^A-Za-z0-9_-]/g, "");
const G = {
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12.5h2M3 9.5h18"/>',
  balance: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4M12 7.5v1.8M12 16.7v1.8"/>',
  records: '<path d="M8 6h11M8 12h11M8 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  photos: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5.5-5.5L5 19.5"/>'
};

register({
  id: "send", name: ["المحفظة", "Wallet"], tint: "#4cc2ff", pinned: true, glyph: svg(G.wallet),
  mount(body, ctx) {
    const { game, t, toast } = ctx; if (!game.member) return guest(body, t);
    let me = null, step = "form", draft = null, busy = false, key = ikey();
    onFull(body, ctx);
    const load = () => game.host.api("GET", "/api/mjt/me").then((m) => { me = m; paint(); }, () => { body.innerHTML = `<div class="ap-empty">${esc(t("تعذّر تحميل المحفظة", "Couldn't load the wallet"))}</div>`; });
    function paint() {
      const s = me.send || {}, td = me.today || {};
      body.innerHTML = `<div class="ap">
        <div class="wl-card"><small>MJT · ${esc(t("مجتمع كوين", "Mujtama Coin"))}</small><b class="wl-amt">${esc(me.balance.mjt)} <i>MJT</i></b>
          <span class="wl-ok">${me.verified ? "✓ " + esc(t("رصيد موثّق من السجل", "Ledger-verified balance")) : ""}${me.frozen ? " · " + esc(t("المحفظة مجمّدة", "Wallet frozen")) : ""}</span></div>
        ${step === "form" ? `<form class="wl-f" novalidate>
          <h4>${esc(t("إرسال MJT", "Send MJT"))}</h4>
          <label><span>${esc(t("إلى (اسم المستخدم)", "To (username)"))}</span><input name="to" dir="ltr" autocomplete="off" placeholder="@handle" value="${esc(draft?.to || "")}" ${s.allowed ? "" : "disabled"} /></label>
          <label><span>${esc(t("المبلغ", "Amount"))}</span><input name="amount" dir="ltr" inputmode="decimal" placeholder="0" value="${esc(draft?.amount || "")}" ${s.allowed ? "" : "disabled"} /></label>
          <div class="wl-q">${[5, 10, 25, 50].map((v) => `<button type="button" data-q="${v}" ${s.allowed ? "" : "disabled"}>${v}</button>`).join("")}</div>
          <label><span>${esc(t("ملاحظة (اختياري)", "Note (optional)"))}</span><input name="note" maxlength="140" value="${esc(draft?.note || "")}" ${s.allowed ? "" : "disabled"} /></label>
          ${s.allowed ? "" : `<p class="ap-warn">${esc(s.note || t("التحويل غير متاح لحسابك الآن", "Sending isn't available for your account now"))}</p>`}
          <button type="submit" class="mn-go gold" ${s.allowed ? "" : "disabled"}>${esc(t("متابعة", "Continue"))}</button>
          <p class="mn-note">${esc(t("أُرسل اليوم ", "Sent today "))}${esc(td.sent || "0")} / ${esc(td.sendLimit || "—")} MJT</p></form>`
          : `<div class="wl-f wl-c"><h4>${esc(t("تأكيد الإرسال", "Confirm"))}</h4>
          <p class="wl-big">${esc(draft.amount)} MJT</p><p>${esc(t("إلى ", "To "))}<b dir="ltr">@${esc(draft.to)}</b></p>${draft.note ? `<p class="mn-note">«${esc(draft.note)}»</p>` : ""}
          <div class="wl-row"><button type="button" class="mn-go" data-do="back">${esc(t("رجوع", "Back"))}</button><button type="button" class="mn-go gold" data-do="send" ${busy ? "disabled" : ""}>${esc(t("أرسل الآن", "Send now"))}</button></div></div>`}
        <label class="wl-rcv"><input type="checkbox" ${me.receive ? "checked" : ""} /> <span>${esc(t("استقبال التحويلات من الأعضاء", "Receive transfers from members"))}</span></label>
        ${full(ctx, "send")}</div>`;
    }
    body.addEventListener("click", async (e) => {
      const q = e.target.closest("[data-q]"); if (q) { body.querySelector("[name=amount]").value = q.dataset.q; return; }
      const b = e.target.closest("[data-do]"); if (!b || busy) return;
      if (b.dataset.do === "back") { step = "form"; paint(); return; }
      busy = true; b.disabled = true;
      try {
        const r = await game.host.api("POST", "/api/mjt/transfers", { to: draft.to, amount: draft.amount, note: draft.note || undefined, ikey: key });
        game.audio.sfx("reveal"); toast(t("أُرسل ", "Sent ") + r.transfer.amount + " MJT → @" + (r.transfer.to?.handle || draft.to));
        me.balance = r.balance; draft = null; step = "form"; key = ikey(); ctx.refreshBal?.(); await load();
      } catch (err) { toast(err?.message || t("تعذّر الإرسال", "Send failed")); step = "form"; paint(); }
      busy = false;
    });
    body.addEventListener("submit", (e) => {
      e.preventDefault(); const f = e.target, to = f.to.value.trim().replace(/^@/, ""), amount = f.amount.value.trim().replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)), note = f.note.value.trim();
      if (!/^[A-Za-z0-9_.]{2,60}$/.test(to)) { toast(t("اكتب اسم مستخدم صحيح", "Enter a valid username")); return; }
      if (!(Number(amount) > 0)) { toast(t("اكتب مبلغاً أكبر من صفر", "Enter an amount above zero")); return; }
      draft = { to, amount, note }; step = "confirm"; game.audio.sfx("tap"); paint();
    });
    body.addEventListener("change", async (e) => {
      if (!e.target.matches(".wl-rcv input")) return; const on = e.target.checked;
      try { await game.host.api("PUT", "/api/mjt/receive", { receive: on }); me.receive = on; toast(on ? t("الاستقبال مفعّل", "Receiving on") : t("أوقفت الاستقبال", "Receiving off")); } catch (err) { e.target.checked = !on; toast(err?.message || t("تعذّر الحفظ", "Couldn't save")); }
    });
    body.innerHTML = `<div class="ap-empty">${esc(t("جارٍ التحميل…", "Loading…"))}</div>`; load();
  }
});

register({
  id: "balance", name: ["الرصيد", "Balance"], tint: "#46d39a", glyph: svg(G.balance),
  mount(body, ctx) {
    const { game, t } = ctx; if (!game.member) return guest(body, t);
    onFull(body, ctx); body.innerHTML = `<div class="ap-empty">${esc(t("جارٍ التحميل…", "Loading…"))}</div>`;
    Promise.all([game.host.api("GET", "/api/mjt/me"), game.host.api("GET", "/api/mjt/mining").catch(() => null)]).then(([m, mn]) => {
      const td = m.today || {}, k = Math.min(1, Number(td.earned || 0) / Math.max(1, Number(td.cap || 1)));
      body.innerHTML = `<div class="ap">
        <div class="wl-card green"><small>${esc(t("رصيدك الحالي", "Your balance"))}</small><b class="wl-amt">${esc(m.balance.mjt)} <i>MJT</i></b><span class="wl-ok">${m.verified ? "✓ " + esc(t("مطابق لسجل القيود المزدوجة", "Matches the double-entry ledger")) : esc(t("قيد المراجعة", "Under review"))}</span></div>
        <h4>${esc(t("اليوم", "Today"))}</h4>
        <div class="bl-bar"><i style="width:${(k * 100).toFixed(1)}%"></i></div>
        <p class="mn-note">${esc(t("كسبت ", "Earned "))}${esc(td.earned || "0")} / ${esc(td.cap || "—")} MJT ${esc(t("من حد المكافآت اليومي", "of the daily reward cap"))}</p>
        <div class="mn-kpi">${[[t("أُرسل اليوم", "Sent today"), (td.sent || "0") + " / " + (td.sendLimit || "—")],
          [t("المعدّن كله", "Total mined"), mn?.totals?.mined ?? "—"], [t("أيام متتالية", "Streak"), mn?.totals?.streak ?? "—"],
          [t("الاستقبال", "Receiving"), m.receive ? t("مفعّل", "On") : t("متوقف", "Off")], [t("الحالة", "Status"), m.frozen ? t("مجمّدة", "Frozen") : t("نشطة", "Active")]]
          .map(([a, b]) => `<div><small>${esc(a)}</small><b>${esc(String(b))}</b></div>`).join("")}</div>
        ${m.conversion ? `<p class="mn-note bl-conv">${esc(t("حُوّلت ", "Converted "))}${esc(String(m.conversion.pts))} ${esc(t("نقطة مساهمة إلى ", "contribution points to "))}${esc(m.conversion.mjt)} MJT</p>` : ""}
        ${full(ctx, "balance")}</div>`;
    }, () => { body.innerHTML = `<div class="ap-empty">${esc(t("تعذّر تحميل الرصيد", "Couldn't load the balance"))}</div>`; });
  }
});

register({
  id: "history", name: ["السجلات", "Records"], tint: "#b48cff", glyph: svg(G.records), wide: true,
  mount(body, ctx) {
    const { game, t } = ctx; if (!game.member) return guest(body, t);
    let items = [], next = null, filt = "all", busy = false;
    onFull(body, ctx);
    body.innerHTML = `<div class="ap"><div class="rc-seg">${[["all", t("الكل", "All")], ["in", t("وارد", "In")], ["out", t("صادر", "Out")]].map(([k, l]) => `<button type="button" data-f="${k}" class="${k === "all" ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
      <ol class="rc-list"></ol><button type="button" class="mn-go rc-more" hidden>${esc(t("عرض المزيد", "Load more"))}</button>${full(ctx, "history")}</div>`;
    const list = body.querySelector(".rc-list"), more = body.querySelector(".rc-more");
    const paint = () => {
      const v = items.filter((x) => filt === "all" || (filt === "in" ? Number(x.amount) > 0 : Number(x.amount) < 0));
      list.innerHTML = v.map((x) => { const pos = Number(x.amount) > 0; return `<li class="${pos ? "in" : "out"}"><span class="rc-ic">${pos ? "↓" : "↑"}</span>
        <div class="rc-m"><b>${esc(x.label)}</b><small>${x.with ? `<span dir="ltr">@${esc(x.with.handle || "")}</span> · ` : ""}${esc(ago(x.createdAt))}${x.note ? " · «" + esc(x.note) + "»" : ""}</small></div>
        <div class="rc-a"><b dir="ltr">${pos ? "+" : ""}${esc(x.amount)}</b><small dir="ltr">${esc(x.balanceAfter)}</small></div></li>`; }).join("")
        || `<li class="none">${esc(busy ? t("جارٍ التحميل…", "Loading…") : t("لا عمليات بعد", "No activity yet"))}</li>`;
      more.hidden = !next;
    };
    const load = async () => {
      if (busy) return; busy = true; more.disabled = true; paint();
      try { const r = await game.host.api("GET", "/api/mjt/history?limit=30" + (next ? "&cursor=" + encodeURIComponent(next) : "")); items = items.concat(r.items || []); next = r.next; }
      catch { list.innerHTML = `<li class="none">${esc(t("تعذّر تحميل السجلات", "Couldn't load records"))}</li>`; busy = false; return; }
      busy = false; more.disabled = false; paint();
    };
    body.addEventListener("click", (e) => { const f = e.target.closest("[data-f]"); if (f) { filt = f.dataset.f; body.querySelectorAll("[data-f]").forEach((b) => b.classList.toggle("on", b === f)); paint(); } else if (e.target.closest(".rc-more")) load(); });
    load();
  }
});

// ---------- Photos: wallpapers. Presets, or the member's own photos (downscaled on the device, kept on this device) ----------
register({
  id: "photos", name: ["الصور", "Photos"], tint: "#ff9f43", pinned: true, wide: true, glyph: svg(G.photos),
  mount(body, ctx) {
    const { t, toast } = ctx;
    let tab = "walls", cur = wallGet(), edit = null;
    const MAXP = 6;
    function shrink(file) {
      return new Promise((res, rej) => {
        const u = URL.createObjectURL(file), im = new Image();
        im.onload = () => { const k = Math.min(1, 1920 / Math.max(im.width, im.height)), c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL("image/jpeg", 0.84)); };
        im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("bad image")); }; im.src = u;
      });
    }
    const thumbCss = (w) => w.kind === "img" ? `background:#06070d url("${w.data}") ${w.x ?? 50}% ${w.y ?? 50}%/cover` : `background:${WALLS[w.id]?.css || "radial-gradient(120% 80% at 50% 115%, #6b4410, #0b0f24 60%)"}`;
    function paint() {
      const ph = photosGet();
      body.innerHTML = `<div class="ap ph">
        <div class="rc-seg">${[["walls", t("الخلفيات", "Wallpapers")], ["mine", t("صوري", "My photos")]].map(([k, l]) => `<button type="button" data-tab="${k}" class="${tab === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
        ${edit ? editor() : tab === "walls"
          ? `<div class="ph-grid">${Object.entries(WALLS).map(([id, w]) => `<button type="button" class="ph-t ${cur.kind === "preset" && cur.id === id ? "on" : ""}" data-wall="${id}"><i style='${thumbCss({ kind: "preset", id })}'></i><span>${esc(t(w.name[0], w.name[1]))}</span></button>`).join("")}</div>`
          : `<div class="ph-grid">
              <label class="ph-t ph-add"><input type="file" accept="image/*" hidden /><i>+</i><span>${esc(t("أضف صورة من جهازك", "Add a photo"))}</span></label>
              ${ph.map((p, i) => `<div class="ph-t ${cur.kind === "img" && cur.data === p ? "on" : ""}"><button type="button" class="ph-pick" data-ph="${i}"><i style='${thumbCss({ kind: "img", data: p })}'></i></button><button type="button" class="ph-del" data-del="${i}" aria-label="${esc(t("حذف", "Delete"))}">✕</button></div>`).join("")}
            </div><p class="mn-note">${esc(t(`تُحفظ صورك على هذا الجهاز فقط (حتى ${MAXP} صور).`, `Your photos stay on this device only (up to ${MAXP}).`))}</p>`}
      </div>`;
    }
    function editor() {
      const e = edit;
      return `<div class="ph-ed">
        <div class="ph-pv" title="${esc(t("اسحب لتحديد نقطة التركيز", "Drag to set the focus point"))}"><b style='background:#06070d url("${e.data}") ${e.x}% ${e.y}%/${e.fit === "contain" ? "contain" : e.fit === "center" ? "auto" : "cover"} no-repeat;filter:${e.blur ? `blur(${e.blur / 2}px)` : "none"}'></b><s style="opacity:${e.dim / 100}"></s><em>${esc(t("معاينة سطح المكتب", "Desktop preview"))}</em></div>
        <div class="ph-ctl">
          <div class="rc-seg">${[["cover", t("ملء", "Fill")], ["contain", t("احتواء", "Fit")], ["center", t("توسيط", "Centre")]].map(([k, l]) => `<button type="button" data-fit="${k}" class="${e.fit === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
          <label><span>${esc(t("التعتيم", "Dim"))}</span><input type="range" min="0" max="70" value="${e.dim}" data-r="dim" /></label>
          <label><span>${esc(t("التنعيم", "Blur"))}</span><input type="range" min="0" max="12" value="${e.blur}" data-r="blur" /></label>
          <div class="wl-row"><button type="button" class="mn-go" data-do="cancel">${esc(t("إلغاء", "Cancel"))}</button><button type="button" class="mn-go gold" data-do="apply">${esc(t("تعيين كخلفية", "Set as wallpaper"))}</button></div>
        </div></div>`;
    }
    const apply = (w) => { if (!wallSet(w)) { toast(t("مساحة التخزين ممتلئة — احذف صورة", "Storage full — delete a photo")); return; } cur = w; ctx.wall(w); ctx.game.audio.sfx("reveal"); toast(t("تم تغيير الخلفية", "Wallpaper changed")); };
    body.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.tab) { tab = b.dataset.tab; edit = null; paint(); return; }
      if (b.dataset.wall) { apply({ kind: "preset", id: b.dataset.wall }); paint(); return; }
      if (b.dataset.ph) { const d = photosGet()[Number(b.dataset.ph)]; const same = cur.kind === "img" && cur.data === d; edit = same ? { ...cur } : { data: d, fit: "cover", x: 50, y: 50, dim: 15, blur: 0 }; paint(); return; }
      if (b.dataset.del) { const a = photosGet(), [d] = a.splice(Number(b.dataset.del), 1); photosSet(a); if (cur.kind === "img" && cur.data === d) apply({ kind: "preset", id: "mjt" }); paint(); return; }
      if (b.dataset.fit) { edit.fit = b.dataset.fit; paint(); return; }
      if (b.dataset.do === "cancel") { edit = null; paint(); return; }
      if (b.dataset.do === "apply") { apply({ kind: "img", ...edit }); edit = null; paint(); }
    });
    body.addEventListener("input", (e) => { const r = e.target.dataset?.r; if (!r || !edit) return; edit[r] = Number(e.target.value); const pv = body.querySelector(".ph-pv"); pv.querySelector("s").style.opacity = String(edit.dim / 100); pv.querySelector("b").style.filter = edit.blur ? `blur(${edit.blur / 2}px)` : "none"; });
    body.addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      if (!/^image\//.test(f.type)) { toast(t("اختر ملف صورة", "Choose an image file")); return; }
      try {
        const d = await shrink(f), a = photosGet(); a.unshift(d); while (a.length > MAXP) a.pop();
        if (!photosSet(a)) { toast(t("مساحة التخزين ممتلئة — احذف صورة", "Storage full — delete a photo")); return; }
        edit = { data: d, fit: "cover", x: 50, y: 50, dim: 15, blur: 0 }; paint();
      } catch { toast(t("تعذّر قراءة الصورة", "Couldn't read the image")); }
    });
    // drag on the preview to move the focal point
    let drag = false;
    const mv = (e) => { const pv = e.target.closest?.(".ph-pv") || body.querySelector(".ph-pv"); if (!drag || !pv || !edit) return; const r = pv.getBoundingClientRect(); edit.x = Math.round(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))); edit.y = Math.round(Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))); pv.querySelector("b").style.backgroundPosition = `${edit.x}% ${edit.y}%`; };
    body.addEventListener("pointerdown", (e) => { if (e.target.closest(".ph-pv")) { drag = true; e.target.closest(".ph-pv").setPointerCapture?.(e.pointerId); mv(e); } });
    body.addEventListener("pointermove", mv);
    body.addEventListener("pointerup", () => { drag = false; });
    paint();
  }
});

// stats keeps opening the full station page, as before
const station = (id, name, tint, glyph) => register({ id, name, tint, glyph: svg(glyph), launch: (ctx) => { ctx.close(); ctx.game.openStation(id); } });
station("stats", ["الإحصاءات", "Stats"], "#ff7ab6", '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>');
