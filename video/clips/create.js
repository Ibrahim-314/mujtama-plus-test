/* مجتمع بلس — «فيديوتك» (Vidtik) v2.75: the dedicated full-screen editor for short videos (video/clips/create.js).
 * Part of the lazy "clips" chunk; block marker: v275-create. Route: #/clips/create.
 * Short videos are published ONLY from here (data.video.source = "clips"); the regular post composer now publishes
 * videos to the normal feed (source = "post"). Older videos with no source keep showing in فيديوتك (nothing removed).
 *  1. Pick: «اختر من الجهاز» (gallery) or «صوّر الآن» (the phone camera through the native capture picker). Up to 3 min.
 *  2. The upload starts at once in the background (resumable chunks for big files, retry + resume when back online)
 *     while the creator writes: live 9:16 preview, caption with #hashtags, cover frame picker, product / job link.
 *  3. «نشر» → POST /api/posts {type:"video", video:{source:"clips"}} (+ cover image, + PUT /api/clips/:id/link)
 *     then the creator's فيديوتك profile, where the clip shows as «جارٍ التجهيز» until processing ends.
 * Smoothness: every control is a plain button (touch-action: manipulation, no 300 ms delay), heavy work (frame capture,
 * uploads) never runs on a tap handler's critical path, the preview is one <video> with an object URL (no re-encode). */
(function VidtikCreate() {
  const { ic, api, online } = Clips.util;
  /* === v275-create === */
  const T = (s) => (window.MPI18n?.t ? MPI18n.t(s) : s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const say = (m) => { if (typeof toast === "function") toast(m); };
  const MAX_S = 180, MAX_CAP = 2200, SMALL = 20 * 1024 * 1024;
  let ed = null; // the live editor state (one at a time)

  /* ---------- upload (same server API as the composer: single POST, or resumable chunks) ---------- */
  async function upload(f, ui) {
    if (f.size <= SMALL) { ui.onProgress?.(-1); const m = (await api("POST", "/api/media", null, f)).media; ui.onProgress?.(1); return m; }
    const stop = () => { if (ui.cancelled?.()) { const e = new Error(T("أُلغي الرفع")); e.code = "cancelled"; throw e; } };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const offline = (e) => e?.status === 0 || e?.code === "offline" || navigator.onLine === false;
    const backOnline = () => new Promise((r) => { if (navigator.onLine) return r(); addEventListener("online", () => r(), { once: true }); });
    /* v2.82: resume after a reload / closed tab — the session id is kept per file (name + size + modified time); picking the
     * same file again continues from the chunks the server already has (24 h, the server's session lifetime). */
    const RK = "mp.upresume", fk = `${f.name}|${f.size}|${f.lastModified || 0}`;
    const saved = () => { try { return JSON.parse(localStorage.getItem(RK) || "{}"); } catch { return {}; } };
    const keep = (id) => { try { const o = saved(); for (const [k, v] of Object.entries(o)) if (Date.now() - v.at > 864e5) delete o[k]; if (id) o[fk] = { id, at: Date.now() }; else delete o[fk]; localStorage.setItem(RK, JSON.stringify(o)); } catch { } };
    let u = null; const prev = saved()[fk];
    if (prev?.id) { try { u = (await api("GET", `/api/media/uploads/${encodeURIComponent(prev.id)}`)).upload; if (u && u.completed && u.media) { keep(null); ui.onProgress?.(1); return u.media; } if (u && u.completed) u = null; else if (u) ui.onResume?.(); } catch { u = null; } }
    if (!u) { u = (await api("POST", "/api/media/uploads", { filename: f.name || "video.mp4", mime: f.type || "video/mp4", size: f.size })).upload; keep(u.uploadId); }
    let todo = [...(u.missing || Array.from({ length: u.totalChunks }, (_, i) => i))], done = u.totalChunks - todo.length;
    // remaining time from the measured speed of this session (smoothed), shown once a few chunks have gone
    const t0 = Date.now(), done0 = done; let eta = null;
    const tick = () => { const sent = done - done0, el = (Date.now() - t0) / 1000; if (sent >= 2 && el > 1) { const left = (u.totalChunks - done) * el / sent; eta = eta == null ? left : eta * 0.6 + left * 0.4; } ui.onProgress?.(Math.min(0.99, done / u.totalChunks), eta == null ? null : Math.max(1, Math.round(eta))); }; tick();
    while (todo.length) {
      stop(); const i = todo[0];
      for (let n = 1; ; n++) {
        try { await api("PUT", `/api/media/uploads/${encodeURIComponent(u.uploadId)}/chunk?index=${i}`, null, f.slice(i * u.chunkSize, Math.min(f.size, (i + 1) * u.chunkSize))); break; }
        catch (e) {
          stop();
          if (offline(e)) { ui.onWait?.(true); await backOnline(); ui.onWait?.(false); stop(); const s = (await api("GET", `/api/media/uploads/${encodeURIComponent(u.uploadId)}`)).upload; todo = [...s.missing]; done = s.totalChunks - todo.length; tick(); n = 0; if (!todo.includes(i)) break; continue; }
          if (n >= 3 || (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status))) throw e;
          await wait(400 * 3 ** (n - 1));
        }
      }
      todo = todo.filter((x) => x !== i); done++; tick();
    }
    stop();
    const m = (await api("POST", `/api/media/uploads/${encodeURIComponent(u.uploadId)}/complete`)).media; keep(null); ui.onProgress?.(1); return m;
  }

  /* ---------- view ---------- */
  function shell() {
    return `<div class="vt-ed" role="region" aria-labelledby="vt-ed-h">
      <header class="vt-ed-top">
        <button type="button" class="vt-ib" data-vt="close" aria-label="${T("إغلاق")}">${ic("x")}</button>
        <h1 id="vt-ed-h"><span>${T("فيديو جديد")}</span> <small>${T("فيديوتك")}</small></h1>
        <span class="vt-ib-sp" aria-hidden="true"></span>
      </header>
      <section class="vt-pick" data-step="pick">
        <div class="vt-pick-frame" aria-hidden="true"><span class="vt-pick-ic">${ic("clapper", "lg")}</span></div>
        <p class="vt-pick-t">${T("مقطع عمودي حتى 3 دقائق")}</p>
        <div class="vt-pick-btns">
          <button type="button" class="btn vt-btn-main" data-vt="gallery">${ic("download", "sm")}<span>${T("اختر من الجهاز")}</span></button>
          <button type="button" class="btn ghost vt-btn" data-vt="camera">${ic("camera", "sm")}<span>${T("صوّر الآن")}</span></button>
        </div>
        <p class="vt-err" role="alert" hidden></p>
      </section>
      <section class="vt-edit" data-step="edit" hidden>
        <div class="vt-stage">
          <div class="vt-up" aria-hidden="true"><i></i></div>
          <div class="vt-frame">
            <video playsinline webkit-playsinline loop muted preload="auto"></video>
            <p class="vt-nopv">${T("المعاينة غير متاحة على هذا الجهاز، وسيُرفع الفيديو كما هو")}</p>
            <button type="button" class="vt-ib vt-play" data-vt="play" aria-label="${T("تشغيل / إيقاف")}">${ic("pause", "sm")}</button>
            <button type="button" class="vt-ib vt-mute" data-vt="mute" aria-label="${T("الصوت")}" aria-pressed="false">${ic("volumeX", "sm")}</button>
          </div>
        </div>
        <div class="vt-panel">
          <p class="vt-st" aria-live="polite"></p>
          <label class="vt-lbl" for="vt-cap">${T("الوصف")}</label>
          <textarea id="vt-cap" class="vt-cap" rows="3" maxlength="${MAX_CAP}" placeholder="${T("اكتب وصفاً… وأضف #وسوم")}"></textarea>
          <div class="vt-cap-meta"><span class="vt-tags" aria-live="polite"></span><span class="vt-n"><bdi>0</bdi>/${MAX_CAP}</span></div>
          <div class="vt-row vt-cover">
            <canvas class="vt-cv" width="180" height="320" aria-hidden="true"></canvas>
            <div class="vt-cover-c">
              <label class="vt-lbl" for="vt-cr">${T("الغلاف")}</label>
              <input id="vt-cr" class="vt-range" type="range" min="0" max="1000" value="0" step="1">
              <p class="vt-hint">${T("حرّك لاختيار لقطة الغلاف")}</p>
            </div>
          </div>
          <div class="vt-row vt-trim" hidden>
            <span class="vt-lbl" id="vt-trim-l">${T("قص المقطع")}</span>
            <div class="vt-trim-c" role="group" aria-labelledby="vt-trim-l">
              <label class="vt-trim-r"><span>${T("البداية")}</span><input id="vt-ts" class="vt-range" type="range" min="0" max="1000" value="0" step="1"><output for="vt-ts" class="vt-trim-v">0:00</output></label>
              <label class="vt-trim-r"><span>${T("النهاية")}</span><input id="vt-te" class="vt-range" type="range" min="0" max="1000" value="1000" step="1"><output for="vt-te" class="vt-trim-v">0:00</output></label>
              <p class="vt-hint vt-trim-len" aria-live="polite"></p>
            </div>
          </div>
          <div class="vt-row vt-link" hidden>
            <span class="vt-lbl">${T("اربط منتجاً أو وظيفة")}</span>
            <div class="vt-chips" role="radiogroup" aria-label="${T("اربط منتجاً أو وظيفة")}"></div>
          </div>
          <div class="vt-row vt-sched">
            <label class="vt-sw"><input type="checkbox" id="vt-sch"><span>${T("جدولة النشر")}</span></label>
            <div class="vt-sched-at" hidden>
              <label class="vt-lbl" for="vt-at">${T("موعد النشر")}</label>
              <input id="vt-at" class="vt-at" type="datetime-local" step="300">
              <p class="vt-hint">${T("يُنشر تلقائياً في هذا الموعد بتوقيت جهازك")}</p>
            </div>
          </div>
          <div class="vt-acts">
            <button type="button" class="btn ghost vt-btn" data-vt="replace">${ic("refresh", "sm")}<span>${T("تغيير الفيديو")}</span></button>
            <button type="button" class="btn ghost vt-btn vt-draft" data-vt="draft" disabled>${ic("save", "sm")}<span>${T("حفظ مسودة")}</span></button>
            <button type="button" class="btn vt-btn-main vt-pub" data-vt="publish" disabled><span>${T("نشر")}</span></button>
          </div>
        </div>
      </section>
    </div>`;
  }

  function render() {
    if (window.MPSession?.state === "out") {
      document.body.classList.remove("shorts-mode");
      view.innerHTML = `<div class="wrap vt-guest"><div class="empty"><p>${T("سجّل الدخول لنشر فيديو في فيديوتك")}</p><button type="button" class="btn" data-vt-login>${T("تسجيل الدخول")}</button></div></div>`;
      view.querySelector("[data-vt-login]").onclick = () => { if (typeof showAuth === "function") showAuth("login"); };
      return;
    }
    cleanup();
    document.body.classList.add("shorts-mode", "vt-ed-mode");
    view.innerHTML = shell();
    const root = view.querySelector(".vt-ed");
    ed = { root, file: null, url: "", media: null, up: null, cancel: false, cover: false, link: null, busy: false, dur: 0, draftId: null };
    const me = ed;
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-vt]"); if (!b || b.disabled) return;
      const a = b.dataset.vt;
      if (a === "close") return close();
      if (a === "gallery") return pick(false);
      if (a === "camera") return pick(true);
      if (a === "replace") return pick(false);
      if (a === "play") return togglePlay();
      if (a === "mute") return toggleMute(b);
      if (a === "publish") return publish();
      if (a === "draft") return saveDraft();
    });
    const sch = root.querySelector("#vt-sch"), at = root.querySelector("#vt-at");
    sch.addEventListener("change", () => { root.querySelector(".vt-sched-at").hidden = !sch.checked; if (sch.checked && !at.value) at.value = localInput(Date.now() + 3600e3); at.min = localInput(Date.now() + 5 * 60e3); pubState(); });
    at.addEventListener("input", pubState);
    const cap = root.querySelector("#vt-cap");
    let capT = 0;
    cap.addEventListener("input", () => { cancelAnimationFrame(capT); capT = requestAnimationFrame(() => meta(cap.value)); });
    const cr = root.querySelector("#vt-cr"); let seekT = 0;
    cr.addEventListener("input", () => {
      const v = root.querySelector(".vt-stage video"); if (!v || !(v.duration > 0)) return;
      me.cover = true; me.coverSeek = true; if (!v.paused) { v.pause(); playIcon(); }
      cancelAnimationFrame(seekT); seekT = requestAnimationFrame(() => { v.currentTime = Math.min(v.duration - 0.05, (cr.value / 1000) * v.duration); });
    });
    /* v2.82 «قص المقطع»: two handles (start / end), the preview loops inside the range, ≥ 1 s kept; the server cuts on publish */
    const ts = root.querySelector("#vt-ts"), te = root.querySelector("#vt-te");
    const onTrim = (which) => {
      const v = root.querySelector(".vt-stage video"), d = me.dur || v?.duration || 0; if (!(d > 0)) return;
      const gap = Math.ceil(1000 / d); // ≥ 1 s between the handles
      if (which === "s" && +ts.value > +te.value - gap) ts.value = Math.max(0, +te.value - gap);
      if (which === "e" && +te.value < +ts.value + gap) te.value = Math.min(1000, +ts.value + gap);
      trimShow(me);
      if (v) { const t = (which === "s" ? +ts.value : +te.value) / 1000 * d; cancelAnimationFrame(seekT); seekT = requestAnimationFrame(() => { try { v.currentTime = Math.min(d - 0.05, which === "e" ? Math.max(0, t - 0.5) : t); } catch { } }); }
    };
    ts.addEventListener("input", () => onTrim("s")); te.addEventListener("input", () => onTrim("e"));
    addEventListener("hashchange", function off() { removeEventListener("hashchange", off); if (ed === me) cleanup(); });
    const dq = new URLSearchParams(location.hash.split("?")[1] || "").get("draft");
    if (dq) openDraft(me, dq); else loadLinkables(me);
  }

  function cleanup() {
    if (!ed) return;
    ed.cancel = true;
    const v = ed.root?.querySelector(".vt-stage video"); if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
    if (ed.url) URL.revokeObjectURL(ed.url);
    document.body.classList.remove("vt-ed-mode");
    ed = null;
  }
  function close() {
    if (ed && ed.file && !ed.busy && !confirm(T("تجاهل هذا الفيديو؟"))) return;
    location.hash = "#/clips";
  }

  function pick(camera) {
    const inp = Object.assign(document.createElement("input"), { type: "file", accept: "video/*" });
    if (camera) inp.setAttribute("capture", "environment");
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) take(f); };
    inp.click();
  }

  function err(msg) { const p = ed?.root.querySelector(".vt-err"); if (!p) return say(msg); p.textContent = msg; p.hidden = false; }

  function take(f) {
    const me = ed; if (!me) return;
    if (!/^video\//.test(f.type || "") && !/\.(mp4|mov|webm|m4v|3gp)$/i.test(f.name || "")) return err(T("الملف ليس فيديو مدعوماً"));
    const url = URL.createObjectURL(f);
    const probe = document.createElement("video"); probe.preload = "metadata"; probe.muted = true;
    let settled = false;
    const go = (d) => {
      if (settled) return; settled = true; clearTimeout(tmo); probe.removeAttribute("src"); probe.load();
      if (isFinite(d) && d > MAX_S + 0.5) { URL.revokeObjectURL(url); return err(T("الحد الأقصى 3 دقائق")); }
      // a new file replaces the old one: stop its upload, release its URL
      me.cancel = true; if (me.url) URL.revokeObjectURL(me.url);
      Object.assign(me, { file: f, url, media: null, cancel: false, cover: false, dur: isFinite(d) ? d : 0 });
      me.root.querySelector(".vt-err").hidden = true;
      me.root.querySelector('[data-step="pick"]').hidden = true;
      me.root.querySelector('[data-step="edit"]').hidden = false;
      const v = me.root.querySelector(".vt-stage video");
      me.root.querySelector(".vt-frame").classList.remove("nopv"); { const cr = me.root.querySelector(".vt-cover"); if (cr) cr.hidden = false; }
      v.onerror = () => { me.root.querySelector(".vt-frame")?.classList.add("nopv"); const cr = me.root.querySelector(".vt-cover"); if (cr) cr.hidden = true; me.cover = false; const tr = me.root.querySelector(".vt-trim"); if (tr) tr.hidden = true; }; // no frames to pick a cover from: the server poster is used // this browser can't preview the codec: the upload still goes (the server transcodes)
      v.src = url; v.muted = true; v.play().catch(() => { }); playIcon();
      if (!v._vtW) { v._vtW = 1; v.addEventListener("seeked", () => { const e = ed; if (e && e.cover && !e.coverSeek) return; if (e) e.coverSeek = false; drawCover(v); }, { passive: true }); /* v2.82: trim/loop seeks never overwrite a chosen cover */ }
      v.addEventListener("loadeddata", () => drawCover(v), { once: true });
      me.root.querySelector("#vt-cr").value = 0;
      trimReset(me, v);
      startUpload(me);
    };
    // metadata gives the duration check; a format the browser can't read (or a slow probe) still uploads — never a dead end
    const tmo = setTimeout(() => go(NaN), 2500);
    probe.onloadedmetadata = () => go(probe.duration);
    probe.onerror = () => go(NaN);
    probe.src = url;
  }

  /** {start,end} in seconds when the creator cut something (≥ 0.1 s off either end), else null */
  function trimOf(me) {
    const r = me?.root, d = me?.dur || 0; if (!r || !(d > 0) || r.querySelector(".vt-trim")?.hidden) return null;
    const s = Math.round(+r.querySelector("#vt-ts").value / 1000 * d * 10) / 10, e = Math.round(+r.querySelector("#vt-te").value / 1000 * d * 10) / 10;
    return s < 0.1 && e > d - 0.1 ? null : { start: s, end: e };
  }
  function trimShow(me) {
    const r = me?.root, d = me?.dur || 0; if (!r) return;
    const fm = Clips.util.fmtDur, s = +r.querySelector("#vt-ts").value / 1000 * d, e = +r.querySelector("#vt-te").value / 1000 * d;
    const [o1, o2] = r.querySelectorAll(".vt-trim-v"); o1.textContent = fm(s); o2.textContent = fm(e);
    r.querySelector("#vt-ts").setAttribute("aria-valuetext", fm(s)); r.querySelector("#vt-te").setAttribute("aria-valuetext", fm(e));
    const t = trimOf(me); r.querySelector(".vt-trim-len").textContent = t ? T("المدة بعد القص") + " " + fm(t.end - t.start) : T("حرّك المقبضين لقص بداية المقطع أو نهايته");
  }
  function trimReset(me, v) {
    const r = me.root, box = r.querySelector(".vt-trim");
    r.querySelector("#vt-ts").value = 0; r.querySelector("#vt-te").value = 1000;
    const show = () => { if (ed !== me) return; if (!(me.dur > 0) && v.duration > 0 && isFinite(v.duration)) me.dur = v.duration; box.hidden = !(me.dur >= 2) || r.querySelector(".vt-frame").classList.contains("nopv"); trimShow(me); };
    show(); v.addEventListener("loadedmetadata", show, { once: true });
    if (!v._vtTrim) { v._vtTrim = 1; v.addEventListener("timeupdate", () => { const t = ed && trimOf(ed); if (t && !v.paused && (v.currentTime >= t.end || v.currentTime < t.start - 0.3)) { try { v.currentTime = t.start; } catch { } } }); }
  }
  async function applyTrim(me) { // the server keeps the original and re-cuts; same trim twice is a no-op there
    const t = trimOf(me); if (!t && !me.trimSent) return;
    await api("POST", `/api/media/${encodeURIComponent(me.media.id)}/trim`, t || {}); me.trimSent = !!t;
  }
  function drawCover(v) {
    const cv = ed?.root.querySelector(".vt-cv"); if (!cv || !v.videoWidth) return;
    const c = cv.getContext("2d"), W = cv.width, H = cv.height, r = Math.max(W / v.videoWidth, H / v.videoHeight);
    const w = v.videoWidth * r, h = v.videoHeight * r;
    try { c.drawImage(v, (W - w) / 2, (H - h) / 2, w, h); } catch { /* not ready yet */ }
  }

  function status(t) { const p = ed?.root.querySelector(".vt-st"); if (p) p.textContent = t || ""; }
  function bar(x) { // x: 0..1, or -1 = indeterminate
    const el = ed?.root.querySelector(".vt-up"); if (!el) return;
    el.classList.toggle("ind", x < 0); el.classList.toggle("done", x >= 1);
    el.querySelector("i").style.transform = `scaleX(${x < 0 ? 1 : Math.max(0.02, x)})`;
  }
  function pubState() {
    const b = ed?.root.querySelector(".vt-pub"); if (!b) return;
    const when = schedAt();
    b.disabled = !ed.media || ed.busy || when === false;
    b.querySelector("span").textContent = ed.busy ? T("جارٍ النشر…") : !ed.media ? T("جارٍ الرفع…") : when ? T("جدولة") : T("نشر");
    const d = ed.root.querySelector(".vt-draft"); if (d) d.disabled = !ed.media || ed.busy;
  }
  /* v2.80 scheduling: null = publish now, false = the switch is on but the time is missing / too soon, else an ISO time */
  const localInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };
  function schedAt() {
    const r = ed?.root; if (!r || !r.querySelector("#vt-sch")?.checked) return null;
    const v = r.querySelector("#vt-at").value; if (!v) return false;
    const ms = new Date(v).getTime(); // datetime-local is read in the device's time zone
    return Number.isFinite(ms) && ms >= Date.now() + 4 * 60e3 ? new Date(ms).toISOString() : false;
  }

  async function startUpload(me) {
    const f = me.file; me.media = null; pubState(); bar(0); status(T("جارٍ رفع الفيديو…"));
    try {
      const m = await upload(f, { onProgress: (x, eta) => { if (me.file === f) { bar(x); if (x >= 0 && x < 1) status(T("جارٍ رفع الفيديو…") + " " + Math.round(x * 100) + "%" + (eta ? " · " + T("باقي نحو") + " " + Clips.util.fmtDur(eta) : "")); } }, onResume: () => { if (me.file === f) say(T("نكمل الرفع من حيث توقف")); }, onWait: (w) => { if (me.file === f) status(w ? T("بانتظار الاتصال… سيُستأنف الرفع تلقائياً") : T("جارٍ رفع الفيديو…")); }, cancelled: () => me.cancel || me.file !== f });
      if (me.file !== f || ed !== me) return;
      if (m.kind && m.kind !== "video") throw new Error(T("الملف ليس فيديو مدعوماً"));
      me.media = m; status(T("جاهز للنشر")); pubState();
    } catch (e) {
      if (e?.code === "cancelled" || me.file !== f) return;
      status(""); bar(0); err(e?.message || T("تعذّر رفع الفيديو"));
      me.root.querySelector('[data-step="pick"]').hidden = false; me.root.querySelector('[data-step="edit"]').hidden = true;
    }
  }

  function playIcon() {
    const v = ed?.root.querySelector(".vt-stage video"), b = ed?.root.querySelector(".vt-play"); if (!v || !b) return;
    b.innerHTML = ic(v.paused ? "play" : "pause", "sm");
  }
  function togglePlay() { const v = ed?.root.querySelector(".vt-stage video"); if (!v) return; if (v.paused) v.play().catch(() => { }); else v.pause(); playIcon(); }
  function toggleMute(b) { const v = ed?.root.querySelector(".vt-stage video"); if (!v) return; v.muted = !v.muted; b.setAttribute("aria-pressed", String(!v.muted)); b.innerHTML = ic(v.muted ? "volumeX" : "volume", "sm"); }

  function tagsOf(s) { return [...new Set((String(s).match(/#([\p{L}\p{N}_]+)/gu) || []).map((x) => x.slice(1)))]; }
  function meta(s) {
    const r = ed?.root; if (!r) return;
    r.querySelector(".vt-n bdi").textContent = String(s.length);
    const t = tagsOf(s).slice(0, 6);
    r.querySelector(".vt-tags").innerHTML = t.map((x) => `<span class="vt-tag">#<bdi data-noi18n>${esc(x)}</bdi></span>`).join("");
  }

  async function loadLinkables(me) {
    if (!online()) return;
    let items = [];
    try { items = (await api("GET", "/api/clips/linkables")).items || []; } catch { return; }
    if (ed !== me || !items.length) return;
    const box = me.root.querySelector(".vt-link"), chips = box.querySelector(".vt-chips");
    const sel = me.link ? items.findIndex((x) => x.kind === me.link.kind && x.id === me.link.id) : -1;
    if (me.link && sel < 0) me.link = null; // a draft's link that is no longer live
    const chip = (x, i) => `<button type="button" role="radio" class="vt-chip" data-i="${i}" aria-checked="${i === sel}">${i < 0 ? `<span>${T("بدون")}</span>` : `${ic(x.kind === "job" ? "brief" : "bag", "xs")}<span><bdi data-noi18n>${esc(x.title)}</bdi></span>`}</button>`;
    chips.innerHTML = chip(null, -1) + items.map(chip).join("");
    box.hidden = false;
    chips.addEventListener("click", (e) => {
      const b = e.target.closest(".vt-chip"); if (!b) return;
      chips.querySelectorAll(".vt-chip").forEach((c) => c.setAttribute("aria-checked", String(c === b)));
      const i = +b.dataset.i; me.link = i < 0 ? null : { kind: items[i].kind, id: items[i].id };
    });
  }

  function coverBlob() {
    return new Promise((res) => {
      const v = ed?.root.querySelector(".vt-stage video"); if (!v || !v.videoWidth) return res(null);
      const W = Math.min(720, v.videoWidth), H = Math.round(W * (v.videoHeight / v.videoWidth));
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      try { cv.getContext("2d").drawImage(v, 0, 0, W, H); cv.toBlob((b) => res(b), "image/jpeg", 0.86); } catch { res(null); }
    });
  }

  // the signed-in user's handle (the app's state lives in DB; S is not a window property)
  function myHandle() {
    const u = (window.DB?.users || []).find((x) => x.id === window.DB?.me);
    if (u?.handle) return u.handle;
    try { return (typeof S !== "undefined" && S.me?.()?.handle) || ""; } catch { return ""; }
  }

  async function publish() {
    const me = ed; if (!me || !me.media || me.busy) return;
    if (!online()) return say(T("لا يوجد اتصال"));
    me.busy = true; pubState();
    try {
      let cover = null;
      if (me.cover) {
        const b = await coverBlob();
        if (b) { try { cover = (await api("POST", "/api/media?kind=image", null, new File([b], "cover.jpg", { type: "image/jpeg" }))).media?.url || null; } catch { cover = null; } }
      }
      const v = me.root.querySelector(".vt-stage video");
      const text = me.root.querySelector("#vt-cap").value.trim();
      const when = schedAt();
      if (when === false) { me.busy = false; pubState(); return say(T("اختر موعداً بعد 5 دقائق على الأقل")); }
      const cut = trimOf(me); await applyTrim(me);
      const body = { type: "video", visibility: "public", text, short: true, video: { mediaId: me.media.id, short: true, source: "clips", duration: Math.round(cut ? cut.end - cut.start : (v?.duration || me.dur || me.media.duration || 0)) || undefined }, ...(cover ? { cover } : {}), ...(when ? { publishAt: when } : {}) };
      const r = await api("POST", "/api/posts", body);
      const post = r?.post;
      if (post && me.link) { try { await api("PUT", `/api/clips/${encodeURIComponent(post.id)}/link`, me.link); } catch (e) { say(e?.message || T("تعذّر ربط المقطع")); } }
      if (post && window.DB?.posts && !DB.posts.some((x) => x.id === post.id)) DB.posts.unshift(post);
      if (post && me.draftId) api("DELETE", `/api/clips/drafts/${encodeURIComponent(me.draftId)}`).catch(() => { }); // published: the draft is done
      say(when ? T("جُدول المقطع") + " — " + new Date(when).toLocaleString(document.documentElement.lang === "en" ? "en-GB" : "ar-SA-u-nu-latn", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : T("نُشر! يُجهَّز المقطع وسيظهر خلال لحظات"));
      const h = myHandle();
      me.busy = false; me.file = null;
      location.hash = h ? "#/clips/@" + encodeURIComponent(h) : "#/clips";
    } catch (e) {
      me.busy = false; pubState(); say(e?.message || T("تعذّر النشر"));
    }
  }

  /* ---------- v2.80 drafts «المسودات»: the uploaded video + caption + cover position + link + time, saved on the server ---------- */
  const newDraftId = () => "cd_" + Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("");
  async function saveDraft() {
    const me = ed; if (!me || !me.media || me.busy) return;
    if (!online()) return say(T("لا يوجد اتصال"));
    const when = schedAt();
    me.busy = true; pubState();
    const id = me.draftId || newDraftId();
    try {
      await applyTrim(me);
      await api("PUT", `/api/clips/drafts/${encodeURIComponent(id)}`, { mediaId: me.media.id, caption: me.root.querySelector("#vt-cap").value, coverPos: me.cover ? +me.root.querySelector("#vt-cr").value : null, link: me.link, publishAt: when || null });
      me.draftId = id; me.file = null; me.busy = false;
      say(T("حُفظت المسودة"));
      location.hash = "#/clips/drafts";
    } catch (e) { me.busy = false; pubState(); say(e?.message || T("تعذّر حفظ المسودة")); }
  }
  async function openDraft(me, id) {
    let d = null;
    try { d = ((await api("GET", "/api/clips/drafts")).items || []).find((x) => x.id === id) || null; } catch { /* offline */ }
    if (ed !== me) return;
    if (!d) { err(online() ? T("المسودة غير موجودة") : T("لا يوجد اتصال")); return loadLinkables(me); }
    if (d.missing || !d.media?.src) { err(T("فيديو هذه المسودة لم يعد متاحاً، اختر فيديو آخر")); me.draftId = d.id; return loadLinkables(me); }
    Object.assign(me, { draftId: d.id, media: { id: d.media.id, kind: "video", duration: d.media.duration }, link: d.link ? { kind: d.link.kind, id: d.link.id } : null, dur: d.media.duration || 0 });
    const r = me.root;
    r.querySelector('[data-step="pick"]').hidden = true; r.querySelector('[data-step="edit"]').hidden = false;
    const cap = r.querySelector("#vt-cap"); cap.value = d.caption || ""; meta(cap.value);
    if (d.publishAt) { r.querySelector("#vt-sch").checked = true; r.querySelector(".vt-sched-at").hidden = false; const at = r.querySelector("#vt-at"); at.value = localInput(Date.parse(d.publishAt)); at.min = localInput(Date.now() + 5 * 60e3); }
    const v = r.querySelector(".vt-stage video");
    v.onerror = () => { r.querySelector(".vt-frame")?.classList.add("nopv"); const cr = r.querySelector(".vt-cover"); if (cr) cr.hidden = true; me.cover = false; };
    if (d.media.poster) v.poster = d.media.poster;
    v.src = d.media.src; v.muted = true; v.play().catch(() => { }); playIcon();
    if (!v._vtW) { v._vtW = 1; v.addEventListener("seeked", () => { const e = ed; if (e && e.cover && !e.coverSeek) return; if (e) e.coverSeek = false; drawCover(v); }, { passive: true }); }
    v.addEventListener("loadeddata", () => {
      drawCover(v);
      if (d.coverPos != null && v.duration > 0) { me.cover = true; me.coverSeek = true; r.querySelector("#vt-cr").value = d.coverPos; v.pause(); playIcon(); v.currentTime = Math.min(v.duration - 0.05, (d.coverPos / 1000) * v.duration); }
    }, { once: true });
    bar(1); status(d.media.status === "ready" ? T("جاهز للنشر") : T("يُجهَّز الفيديو، ويمكنك النشر الآن"));
    pubState(); loadLinkables(me);
  }

  const base = Clips.view;
  Clips.view = function () {
    if (/^#\/clips\/create(\?|$)/.test(location.hash)) return render();
    return base.apply(this, arguments);
  };
  // the feed gets a «＋ فيديو جديد» button (signed-in visitors); it lives inside #view, so leaving the page removes it
  Clips.onView(() => queueMicrotask(() => {
    if (window.MPSession?.state === "out") return;
    const feed = Clips.api.feed(); if (!feed || feed.parentNode.querySelector(".vt-new")) return;
    feed.insertAdjacentHTML("afterend", `<a class="vt-new" href="#/clips/create" aria-label="${T("فيديو جديد")}">${ic("plus")}</a>`);
  }));
  Clips.create = { open: () => { location.hash = "#/clips/create"; } };
  /* === /v275-create === */
})();
