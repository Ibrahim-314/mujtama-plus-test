/* =====================================================================
 * مجتمع بلس — v2.60 «إشعارات المجتمع» (#/c/:id/notify, lazy chunk "cnotify", ~1 KB br; styles in communities.css).
 * A member's notifications for ONE community: all · highlights (announcements + mentions) · muted, a daily digest and a
 * timed mute (GET/PUT /api/communities/:id/notify). Personal notices (decisions about you, approvals, event reminders)
 * always arrive. Opened from the community page «…» menu; community-ui.js loads this chunk for the route.
 * ===================================================================== */
(function CommunityNotify() {
  const ic = (n, c = "") => UI.icon(n, c);
  const api = (...a) => Remote.api(...a);
  /* v2.60: #/c/:id/notify — a member's notifications for ONE community (all / highlights / muted, daily digest, timed mute).
   * Personal notices (decisions about you, approvals, event reminders) always arrive. */
  async function page(id) {
    view.innerHTML = `<div class="wrap"><div class="skel"></div></div>`;
    let d; try { d = await api("GET", `/api/communities/${id}/notify`); } catch (e) { view.innerHTML = `<div class="wrap">${UI.pageHead({ back: [`#/c/${esc(id)}`, "المجتمع"], title: "إشعارات المجتمع", icon: "bell" })}${UI.empty({ title: "لأعضاء المجتمع", text: e.message, action: `<a class="btn ghost sm" href="#/c/${esc(id)}">صفحة المجتمع</a>` })}</div>`; return; }
    const LV = [["all", "bell", "كل شيء", "التعليقات والتفاعلات على منشوراتك، والإعلانات والإشارات."], ["highlights", "mega", "الإعلانات والإشارات فقط", "أهدأ: لا تنبيه للتفاعلات والتعليقات."], ["muted", "bellOff", "كتم المجتمع", "لا شيء من هذا المجتمع إلا ما يخصك شخصياً."]];
    const MU = [[1, "ساعة"], [8, "8 ساعات"], [24, "يوم"], [168, "أسبوع"]];
    const draw = (p) => {
      const until = p.mutedUntil ? new Date(p.mutedUntil).toLocaleString("ar", { numberingSystem: "latn", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
      view.innerHTML = `<div class="wrap c-nt">${UI.pageHead({ back: [`#/c/${esc(id)}`, d.community.name], title: "إشعارات المجتمع", icon: "bell", sub: d.community.name })}
        ${p.mutedUntil ? `<div class="notice warn" role="status">${ic("bellOff", "sm")}<span>المجتمع مكتوم حتى ${esc(until)}</span><button type="button" class="btn ghost sm" id="cn-unmute">إلغاء الكتم</button></div>` : ""}
        <section class="card"><h3 class="u-mt0">ما يصلك من ${esc(d.community.name)}</h3><div class="c-nt-opts" role="radiogroup" aria-label="مستوى الإشعارات">${LV.map(([k, i, t, x]) => `<label class="c-nt-o"><input type="radio" name="cn-l" value="${k}" ${p.level === k ? "checked" : ""}><span>${ic(i, "sm")}<b>${t}</b><small>${x}</small></span></label>`).join("")}</div></section>
        <section class="card"><label class="switch-row"><span><b>ملخص يومي</b><small>رسالة واحدة في اليوم بعدد المنشورات الجديدة</small></span><input type="checkbox" class="switch" role="switch" id="cn-dg" ${p.digest ? "checked" : ""} aria-checked="${p.digest}" aria-label="ملخص يومي"></label></section>
        <section class="card"><h3 class="u-mt0">كتم مؤقت</h3><p class="muted">أوقف إشعارات المجتمع لفترة، ثم تعود تلقائياً.</p><div class="c-nt-mu">${MU.map(([hh, l]) => `<button type="button" class="btn ghost sm" data-mute="${hh}">${l}</button>`).join("")}</div></section>
        <p class="muted c-nt-f">${ic("shield", "xs")} القرارات التي تخصك، وقبول طلبك، وتذكير الفعاليات التي ستحضرها تصلك دائماً. ${p.custom ? "" : `هذا هو الإعداد الافتراضي للمجتمع.`} <a href="#/nsettings">إعدادات الإشعارات العامة</a></p></div>`;
      const save = async (b, msg) => { try { const r = await api("PUT", `/api/communities/${id}/notify`, b); toast(msg); draw(r.prefs); } catch (e) { toast(e.message); draw(p); } };
      view.querySelectorAll('input[name="cn-l"]').forEach((r) => (r.onchange = () => save({ level: r.value }, "✓ حُفظت إشعارات المجتمع")));
      $("#cn-dg").onchange = (e) => save({ digest: e.target.checked }, e.target.checked ? "✓ سيصلك ملخص يومي" : "أُوقف الملخص اليومي");
      view.querySelectorAll("[data-mute]").forEach((b) => (b.onclick = () => save({ muteHours: +b.dataset.mute }, `✓ كُتم المجتمع ${b.textContent}`)));
      $("#cn-unmute")?.addEventListener("click", () => save({ muteHours: 0 }, "✓ أُلغي الكتم"));
    };
    draw(d.prefs);
  }
  window.MPCNotify = { page };
})();
