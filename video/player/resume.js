/* مجتمع بلس — resume watching «تابع المشاهدة» (video/player/resume.js, core bundle; v2.73).
 * window.MPResume { get(id), set(id, t, d), list(), bind(video, post, say) }. Registered as an MPPlayer plugin, so every
 * player mount (feed, post page, clips) resumes without the player knowing about it. */
(function (root) {
  const fmtDur = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, "0")}`;
  /* v2.73 resume watching «تابع المشاهدة»: playback position per video in localStorage (device only, no server store exists),
   * ≥20 s videos only, saved every ~4 s / on pause / on leave, cleared near the end; restored on loadedmetadata. ≤40 entries. */
  const MPResume = (root.MPResume = (() => {
    const K = "mp_resume", MAX = 40;
    const all = () => { try { const o = JSON.parse(localStorage.getItem(K) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; } };
    const put = (o) => { try { const e = Object.entries(o).sort((a, b) => b[1].at - a[1].at).slice(0, MAX); localStorage.setItem(K, JSON.stringify(Object.fromEntries(e))); } catch { /* storage full / private mode */ } };
    const get = (id) => all()[id] || null;
    const set = (id, t, d) => { const o = all(); if (!(d >= 20) || t < 3 || t > d * 0.95 || d - t < 3) delete o[id]; else o[id] = { t: Math.round(t), d: Math.round(d), at: Date.now() }; put(o); };
    const list = () => Object.entries(all()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.at - a.at);
    function bind(vid, p, say) {
      if (!vid || !p?.id || vid._mpRes) return; vid._mpRes = 1; let last = 0;
      const dur = () => (isFinite(vid.duration) && vid.duration > 0 ? vid.duration : +p.video?.duration || 0);
      const save = () => { if (vid.currentTime > 0) set(p.id, vid.currentTime, dur()); };
      vid.addEventListener("loadedmetadata", () => { const r = get(p.id), d = dur(); if (r && d >= 20 && r.t < d - 3 && vid.currentTime < 1) { try { vid.currentTime = r.t; say?.((DB.settings?.lang === "en" ? "Resumed at " : "تابع من ") + fmtDur(r.t)); } catch { /* not seekable yet */ } } }, { once: true });
      vid.addEventListener("timeupdate", () => { const n = Date.now(); if (n - last > 4000) { last = n; save(); } });
      vid.addEventListener("pause", save); vid.addEventListener("ended", () => set(p.id, 0, dur()));
      live.add(save); vid._mpResSave = save;
      for (const f of live) if (f !== save && !f.v?.isConnected) live.delete(f); save.v = vid; // one pagehide listener for every player
    }
    const live = new Set(); addEventListener("pagehide", () => live.forEach((f) => { if (f.v?.isConnected) f(); }));
    return { get, set, list, bind };
  })());
  if (root.MPPlayer?.use) root.MPPlayer.use(({ video, post, flash }) => MPResume.bind(video, post, flash));
})(typeof window !== "undefined" ? window : globalThis);
