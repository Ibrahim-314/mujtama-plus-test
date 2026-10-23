/* مجتمع بلس — chapters «الفصول» for long videos (video/player/chapters.js, core bundle; v2.82).
 * The creator writes chapter lines in the description, one per line: "0:00 مقدمة", "2:15 الفكرة", "1:02:30 الخلاصة".
 * MPChapters.parse(text[, duration]) → [{t, title}] (pure, unit-tested): ≥ 2 lines, the first at 0:00, times strictly
 * increasing, each chapter ≥ 5 s, titles ≤ 60 chars; otherwise []. Registered as an MPPlayer plugin: marks on the progress
 * bar, the current chapter's name in the controls, and a list sheet that jumps to a chapter. Clips (#/clips) are skipped. */
(function (root) {
  const RX = /^\s*(?:[-•*]\s*)?\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|.]?\s*(.{1,80})$/;
  const secs = (s) => s.split(":").reduce((n, x) => n * 60 + +x, 0);
  const fmt = (t) => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
  function parse(text, duration) {
    const out = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const m = RX.exec(line); if (!m) continue;
      const parts = m[1].split(":"); if (parts.slice(1).some((x) => +x > 59)) continue;
      const title = m[2].trim().slice(0, 60); if (!title) continue;
      out.push({ t: secs(m[1]), title });
    }
    if (out.length < 2 || out[0].t !== 0) return [];
    for (let i = 1; i < out.length; i++) if (out[i].t - out[i - 1].t < 5) return [];
    if (duration > 0 && out[out.length - 1].t >= duration) return out.filter((c) => c.t < duration).length >= 2 ? out.filter((c) => c.t < duration) : [];
    return out;
  }
  const at = (list, t) => { let i = 0; for (let j = 0; j < list.length; j++) if (list[j].t <= t + 0.25) i = j; return i; };
  const en = () => root.DB?.settings?.lang === "en";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function bind({ video, box, post, opts }) {
    if (!video || !post || opts?.source === "clips" || box._mpCh) return;
    const list = parse(post.text, +post.video?.duration || 0); if (!list.length) return;
    box._mpCh = list; box.classList.add("has-chapters");
    const seek = box.querySelector(".mp-seek"), bar = box.querySelector(".mp-bar");
    const dur = () => (isFinite(video.duration) && video.duration > 0 ? video.duration : +post.video?.duration || 0);
    const marks = () => { if (!seek) return; seek.querySelectorAll(".mp-ch-mark").forEach((n) => n.remove()); const d = dur(); if (!(d > 0)) return; for (const c of list.slice(1)) if (c.t < d) seek.insertAdjacentHTML("beforeend", `<b class="mp-ch-mark" style="inset-inline-start:${(c.t / d * 100).toFixed(3)}%" aria-hidden="true"></b>`); };
    marks(); video.addEventListener("loadedmetadata", marks, { once: true });
    if (!bar) return;
    bar.insertAdjacentHTML("afterbegin", `<button type="button" class="mp-ch-btn" data-a="chapters" aria-haspopup="dialog" aria-label="${en() ? "Chapters" : "الفصول"}"><span class="mp-ch-now"><bdi>${esc(list[0].title)}</bdi></span></button>`);
    const btn = bar.querySelector(".mp-ch-btn"), now = btn.querySelector(".mp-ch-now"); let cur = 0;
    video.addEventListener("timeupdate", () => { const i = at(list, video.currentTime); if (i !== cur) { cur = i; now.innerHTML = `<bdi>${esc(list[i].title)}</bdi>`; } });
    const close = () => { const s = box.querySelector(".mp-ch-sheet"); if (s) { s.remove(); btn.setAttribute("aria-expanded", "false"); btn.focus(); } };
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); if (box.querySelector(".mp-ch-sheet")) return close();
      const i0 = at(list, video.currentTime);
      box.insertAdjacentHTML("beforeend", `<div class="mp-ch-sheet" role="dialog" aria-label="${en() ? "Chapters" : "الفصول"}"><div class="mp-ch-head"><b>${en() ? "Chapters" : "الفصول"}</b><button type="button" class="mp-ch-x" aria-label="${en() ? "Close" : "إغلاق"}">×</button></div><ol>${list.map((c, i) => `<li><button type="button" data-t="${c.t}" ${i === i0 ? 'aria-current="true"' : ""}><time>${fmt(c.t)}</time><bdi>${esc(c.title)}</bdi></button></li>`).join("")}</ol></div>`);
      const sheet = box.querySelector(".mp-ch-sheet"); btn.setAttribute("aria-expanded", "true");
      ["pointerdown", "pointerup", "click"].forEach((k) => sheet.addEventListener(k, (ev) => ev.stopPropagation()));
      sheet.querySelector(".mp-ch-x").addEventListener("click", close);
      sheet.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); close(); } });
      sheet.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => { try { video.currentTime = +b.dataset.t; } catch { } video.play().catch(() => { }); close(); }));
      (sheet.querySelector('[aria-current="true"]') || sheet.querySelector("[data-t]")).focus();
    });
  }
  const MPChapters = { parse, fmt, bind };
  root.MPChapters = MPChapters;
  if (root.MPPlayer?.use) root.MPPlayer.use(bind);
  if (typeof module !== "undefined" && module.exports) module.exports = MPChapters;
})(typeof window !== "undefined" ? window : globalThis);
