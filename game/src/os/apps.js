/* MJT OS programs. Mining is the first real program (a window inside the OS, live from /api/mjt/mining);
 * the other entries keep every page the old terminal offered (wallet, balance, records, stats) as launchers
 * that open the real station pages. Add a program = one register() call. */
import { register } from "./desktop.js";
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

// launchers: the real pages the old terminal opened (nothing removed)
const station = (id, name, tint, glyph) => register({ id, name, tint, glyph: svg(glyph), launch: (ctx) => { ctx.close(); ctx.game.openStation(id); } });
station("send", ["المحفظة", "Wallet"], "#4cc2ff", '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12.5h2M3 9.5h18"/>');
station("balance", ["الرصيد", "Balance"], "#46d39a", '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4M12 7.5v1.8M12 16.7v1.8"/>');
station("history", ["السجلات", "Records"], "#b48cff", '<path d="M8 6h11M8 12h11M8 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>');
station("stats", ["الإحصاءات", "Stats"], "#ff7ab6", '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>');
