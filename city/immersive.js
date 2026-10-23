/* مجتمع بلس — «مدينة المجتمع الرقمية» immersion (city/immersive.js, v2.86). Three things that make the city a place:
 *
 *   1. The city owns the screen: inside #/city… the app's bottom bar slides away (body.cy-city); it comes back on leaving.
 *   2. Full screen: a button on the map's HUD. Uses the Fullscreen API on the whole document (halls and rooms stay full
 *      screen as the member moves between them); where a phone has no Fullscreen API (iPhone Safari) the same button turns
 *      on an "immersive" layout instead (top bar hidden, the map fills the screen). Leaving the city always exits.
 *   3. Sound: a soft night-city ambience, footsteps while the character walks, a chime on a building, a street blip, and a
 *      rising whoosh through a door's portal. All synthesized with Web Audio (no audio files, nothing to download), started
 *      only after the member's own tap (autoplay rules), quiet by design, paused when the tab is hidden or the city is left.
 *      A speaker button on the HUD mutes/unmutes; the choice is remembered (localStorage "mp.city.sound", default on).
 *      Reduced motion does not mute sound; the member's own mute does.
 * Nothing here adds a page or touches another system; it only dresses the city's own routes. */
(function CityImmersive() {
  "use strict";
  const { el, T, esc } = MPCity.util;
  const inCity = () => /^#\/(city|town)(\/|$|\?)/.test(location.hash || "");
  const doc = document, body = doc.body;

  /* ---------------- 1 + 2: the screen ---------------- */
  const fsEl = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;
  const canFS = () => !!(doc.documentElement.requestFullscreen || doc.documentElement.webkitRequestFullscreen) && (doc.fullscreenEnabled !== false);
  const isFS = () => !!fsEl() || body.classList.contains("cy-imm");
  function enterFS() {
    body.classList.add("cy-imm");
    const r = doc.documentElement;
    try { const p = (r.requestFullscreen || r.webkitRequestFullscreen).call(r, { navigationUI: "hide" }); if (p && p.catch) p.catch(() => { }); } catch { }
    paintFS();
  }
  function exitFS() {
    body.classList.remove("cy-imm");
    if (fsEl()) { try { const p = (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc); if (p && p.catch) p.catch(() => { }); } catch { } }
    paintFS();
  }
  const ICON = {
    fsOn: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    fsOff: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    sndOn: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    sndOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>'
  };
  const ico = (d) => `<svg class="cy-ti" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  function paintFS() {
    const on = isFS();
    doc.querySelectorAll(".cy-tool-fs").forEach((b) => { b.innerHTML = ico(on ? ICON.fsOff : ICON.fsOn); b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", T(on ? "الخروج من ملء الشاشة" : "ملء الشاشة")); b.title = b.getAttribute("aria-label"); });
  }
  const onFsChange = () => { if (!fsEl()) body.classList.remove("cy-imm"); paintFS(); };
  doc.addEventListener("fullscreenchange", onFsChange); doc.addEventListener("webkitfullscreenchange", onFsChange);

  function route() {
    const on = inCity();
    body.classList.toggle("cy-city", on);
    if (!on) { if (isFS()) exitFS(); Sound.pause(); } else Sound.resume();
  }
  /* ---------------- 3: sound ---------------- */
  const SKEY = "mp.city.sound";
  const Sound = (() => {
    let ctx = null, master = null, amb = null, wanted = (() => { try { return localStorage.getItem(SKEY) !== "0"; } catch { return true; } })();
    const AC = window.AudioContext || window.webkitAudioContext;
    function init() {
      if (ctx || !AC) return !!ctx;
      try { ctx = new AC(); } catch { ctx = null; return false; }
      master = ctx.createGain(); master.gain.value = wanted ? 0.9 : 0; master.connect(ctx.destination);
      return true;
    }
    function noiseBuf(sec) {
      const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
      let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } // brown noise
      return b;
    }
    /* the night: a low warm pad (two detuned voices through a slow-breathing filter) over a faint distant-city hum */
    function ambience() {
      if (amb || !ctx) return;
      const out = ctx.createGain(); out.gain.value = 0; out.connect(master);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.7; lp.connect(out);
      const voices = [110, 164.81, 220.6].map((f, i) => { const o = ctx.createOscillator(); o.type = i === 2 ? "sine" : "triangle"; o.frequency.value = f; o.detune.value = i * 7 - 6; const g = ctx.createGain(); g.gain.value = i === 2 ? 0.05 : 0.09; o.connect(g); g.connect(lp); o.start(); return o; });
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      const hum = ctx.createBufferSource(); hum.buffer = noiseBuf(4); hum.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = "bandpass"; hp.frequency.value = 340; hp.Q.value = 0.5;
      const hg = ctx.createGain(); hg.gain.value = 0.05; hum.connect(hp); hp.connect(hg); hg.connect(out); hum.start();
      out.gain.setTargetAtTime(0.22, ctx.currentTime, 1.6);
      amb = { out, nodes: [...voices, lfo, hum] };
    }
    const now = () => ctx.currentTime;
    function env(g, t, peak, a, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
    function tone(freq, t, { type = "sine", peak = 0.18, a = 0.01, d = 0.5, to } = {}) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
      env(g, t, peak, a, d); o.connect(g); g.connect(master); o.start(t); o.stop(t + a + d + 0.05);
    }
    let stepBuf = null, stepN = 0;
    function step() {
      stepBuf = stepBuf || noiseBuf(0.2);
      const t = now(), s = ctx.createBufferSource(); s.buffer = stepBuf; s.playbackRate.value = 0.9 + Math.random() * 0.25;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = (stepN++ % 2 ? 900 : 760) + Math.random() * 120; bp.Q.value = 1.4;
      const g = ctx.createGain(); env(g, t, 0.32, 0.004, 0.09); s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.16);
    }
    const ok = () => !!(ctx && wanted && ctx.state !== "closed");
    return {
      get on() { return wanted; },
      /* called from the member's own taps (a user gesture): creates/resumes the audio and the ambience */
      wake() { if (!wanted || !inCity()) return; if (!init()) return; if (ctx.state !== "running") ctx.resume().catch(() => { }); ambience(); },
      set(v) {
        wanted = !!v; try { localStorage.setItem(SKEY, wanted ? "1" : "0"); } catch { }
        if (wanted) { this.wake(); if (master) master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.15); }
        else if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      },
      pause() { if (ctx && ctx.state === "running") ctx.suspend().catch(() => { }); },
      resume() { if (ctx && wanted && !doc.hidden && inCity() && ctx.state === "suspended") ctx.resume().catch(() => { }); },
      chime() { if (!ok()) return; const t = now(); tone(784, t, { peak: 0.12, d: 0.6 }); tone(1174.7, t + 0.07, { peak: 0.09, d: 0.7 }); },
      blip() { if (!ok()) return; tone(520, now(), { type: "triangle", peak: 0.07, d: 0.16, to: 660 }); },
      miss() { if (!ok()) return; tone(300, now(), { type: "sine", peak: 0.05, d: 0.14, to: 220 }); },
      step() { if (ok()) step(); },
      arrive() { if (!ok()) return; const t = now(); tone(659.3, t, { peak: 0.08, d: 0.35 }); tone(987.8, t + 0.06, { peak: 0.06, d: 0.45 }); },
      door(vault) {
        if (!ok()) return; const t = now();
        const s = ctx.createBufferSource(); s.buffer = noiseBuf(1.4); const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 2;
        f.frequency.setValueAtTime(240, t); f.frequency.exponentialRampToValueAtTime(2600, t + 1.1);
        const g = ctx.createGain(); env(g, t, 0.28, 0.35, 0.9); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + 1.4);
        const base = vault ? 392 : 523.25; [0, 1.25, 1.5, 2].forEach((m, i) => tone(base * m || base * 0.5, t + 0.18 + i * 0.09, { peak: 0.06, a: 0.04, d: 0.9 }));
      },
      coin() { if (!ok()) return; const t = now(); tone(1318.5, t, { type: "square", peak: 0.035, d: 0.12 }); tone(1975.5, t + 0.08, { type: "square", peak: 0.03, d: 0.3 }); }
    };
  })();
  doc.addEventListener("visibilitychange", () => { if (doc.hidden) Sound.pause(); else Sound.resume(); });
  MPCity.sound = Sound;

  addEventListener("hashchange", route);
  route();

  function paintSnd() {
    doc.querySelectorAll(".cy-tool-snd").forEach((b) => { const on = Sound.on; b.innerHTML = ico(on ? ICON.sndOn : ICON.sndOff); b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", T(on ? "كتم صوت المدينة" : "تشغيل صوت المدينة")); b.title = b.getAttribute("aria-label"); });
  }

  /* every city mount: wire the sound to the walk, and put the two HUD buttons next to «شخصيتي» once the head is there */
  MPCity.use((city) => {
    let lastStep = 0;
    city.on("tap", (t) => { Sound.wake(); if (t.kind === "place") Sound.chime(); else if (t.kind === "street") Sound.blip(); else Sound.miss(); });
    city.on("walk", () => { lastStep = 0; });
    city.on("step", (s) => { if (s - lastStep >= 34) { lastStep = s; Sound.step(); } }); // one footstep every ~34 scene px (matches the walk cycle at the city's speed)
    // arriving at a door is the portal's moment (portal.js opens it on the same event): its whoosh; a street gets a soft landing
    city.on("arrive", (goal) => { if (!goal) return; if (goal.kind === "place") Sound.door(!!(goal.place && goal.place.vault)); else if (goal.kind === "street") Sound.arrive(); });
    city.root.addEventListener("pointerdown", () => Sound.wake(), { passive: true });
    requestAnimationFrame(() => {
      const head = city.root.closest(".cy-frame")?.querySelector(".cy-head"); if (!head || head.querySelector(".cy-tools")) return;
      const box = el("div", "cy-tools");
      box.innerHTML = `<button type="button" class="cy-tool cy-tool-snd"></button><button type="button" class="cy-tool cy-tool-fs"></button>`;
      const me = head.querySelector(".cy-me"); if (me) me.before(box); else head.append(box);
      box.querySelector(".cy-tool-snd").addEventListener("click", () => { Sound.set(!Sound.on); paintSnd(); if (Sound.on) Sound.chime(); });
      box.querySelector(".cy-tool-fs").addEventListener("click", () => { Sound.wake(); if (isFS()) exitFS(); else enterFS(); });
      if (!canFS()) box.querySelector(".cy-tool-fs").dataset.css = "1"; // immersive layout only (no Fullscreen API on this device)
      paintSnd(); paintFS();
    });
    // the gold balance chip: a coin's ring on tap
    city.root.closest(".cy-frame")?.addEventListener("click", (e) => { if (e.target.closest(".cy-bal")) Sound.coin(); });
  });
  void esc;
})();
