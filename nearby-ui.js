/* =====================================================================
 * مجتمع بلس — Phase 66 UI: nearby events and places on a map (lazy "nearby" chunk; 0 bytes in core).
 *   #/nearby               map + list of what is around: approximate location (opt-in) or a city, filters
 *   #/place/:id            a place: details, small map, nearby events, report / edit / withdraw
 *   #/places/new           add a public place (pin on the map, address search) → moderation
 *   #/places/mine          places I added and their review status
 *   #/cities  #/city/:name city pages: events, places by category, local communities, location trends (phase 23)
 *   #/admin/places         moderation queue (pending / hidden after reports / rejected)
 * Map: a small self-rendered slippy map over OpenStreetMap standard tiles (no key; attribution always shown; only the
 * visible tiles are requested, nothing is prefetched or stored for offline use — OSMF tile usage policy). Tiles load only
 * when the map scrolls into view; if they cannot load, a self-drawn grid keeps the pins usable.
 * Privacy: the device position is turned into a 5-character geohash (≈ 5 km) HERE, on the device; only that is sent.
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function NearbyUI() {
  if (window.MPNearby) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const km = (x) => (x < 1 ? "أقل من 1 كم" : `نحو <bdi dir="ltr">${Number(x).toLocaleString("en-US", { maximumFractionDigits: 1 })}</bdi> كم`);
  const when = (iso) => { try { return new Intl.DateTimeFormat("ar", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch { return iso; } };
  const ICON = { event: "", mosque: "", cafe: "", restaurant: "", library: "", park: "", coworking: "", education: "", health: "", shop: "", culture: "", sports: "", community: "", other: "" };
  const iconOf = (it) => (it.kind === "event" ? ICON.event : ICON[it.category] || ICON.other);
  const stars = (n) => `<span class="nb-stars" aria-hidden="true">${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}</span>`;
  const openChip = (o) => (o ? `<span class="nb-open ${o.open ? "" : "no"}">${h(o.label)}</span>` : "");
  async function shareLink(url, title) {
    const full = location.origin + "/" + url.replace(/^\/?/, "");
    try { if (navigator.share) { await navigator.share({ title, url: full }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(full); say("نُسخ الرابط"); } catch { prompt("انسخ الرابط", full); }
  }
  async function rsvp(btn, id) {
    const on = btn.getAttribute("aria-pressed") !== "true";
    if (!DB.me) return say("سجّل الدخول لتأكيد حضورك");
    btn.disabled = true;
    try { await api(on ? "PUT" : "DELETE", `/api/events/${enc(id)}/rsvp/going`); btn.setAttribute("aria-pressed", String(on)); btn.textContent = on ? "✓ سأحضر" : "سأحضر"; const c = btn.parentElement.querySelector(".nb-going"); if (c) { const n = Math.max(0, (+c.dataset.n || 0) + (on ? 1 : -1)); c.dataset.n = n; c.textContent = n ? `${n} سيحضر` : ""; } say(on ? "سجّلنا حضورك — ستجده في فعالياتك" : "ألغيت حضورك"); }
    catch (e) { say(e.message); } finally { btn.disabled = false; }
  }
  const rsvpBtn = (it) => (it.kind === "event" ? `<span class="u-t-xs nb-going muted" data-n="${it.going || 0}">${it.going ? `${it.going} سيحضر` : ""}</span><button type="button" class="btn ghost nb-rsvp" data-rsvp="${h(it.id)}" aria-pressed="${it.myRsvp === "going"}">${it.myRsvp === "going" ? "✓ سأحضر" : "سأحضر"}</button>` : "");
  const wireRsvp = (root) => root?.querySelectorAll("[data-rsvp]:not([data-w])").forEach((b) => { b.dataset.w = "1"; b.addEventListener("click", (e) => { e.preventDefault(); rsvp(b, b.dataset.rsvp); }); });
  let CFG = null;
  const config = async () => (CFG ||= await api("GET", "/api/nearby/config").catch(() => ({ tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "مساهمو OpenStreetMap", attributionUrl: "https://www.openstreetmap.org/copyright", minZoom: 3, maxZoom: 18, defaultZoom: 12, categories: [], reportReasons: {} })));
  const page = (title, body, back) => { view.innerHTML = `<div class="wrap nb-page"><header class="page-head">${back ? `<a class="back" href="${back[0]}"><span class="fwd" aria-hidden="true">→</span> ${h(back[1])}</a>` : ""}<div class="ph-main"><div><h2 id="nb-h" tabindex="-1">${String(title).replaceAll("<svg class=ix", "<svg class=ic")}</h2></div></div></header>${body}</div>`; $("#nb-h")?.focus({ preventScroll: true }); };
  if (!document.getElementById("nb-css")) document.head.insertAdjacentHTML("beforeend", `<style id="nb-css">
.nb-page{max-width:820px;margin:auto}.nb-page h2:focus{outline:none}.nb-page h3:not(.f-h){font-size:var(--fs-lg);font-weight:800;margin:22px 0 8px}.nb-loc{font-size:var(--fs-sm);line-height:1.6;color:var(--text-2)}.nb-lh{display:flex;align-items:center;gap:var(--s3)}.nb-lh>.ic{flex:none;width:40px;height:40px;padding:9px;border-radius:var(--r-sm);background:var(--accent-soft);color:var(--accent-ink)}.nb-lh>div{flex:1;min-width:0}.nb-lh b{display:block;font-size:var(--fs-md)}.nb-lh small{display:block;color:var(--muted)}.nb-lr{flex-wrap:nowrap}.nb-lr>.btn{flex:none;white-space:nowrap}.nb-lr>select{flex:1;min-width:0}.nb-sv{min-height:40px;padding:0;font-weight:600}.nb-loc b{color:var(--text)}.nb-page>.btn.block{margin:var(--s3) 0}
.nb-row{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:10px 0}.nb-row .btn,.nb-row a.btn,.nb-row select,.nb-row input{min-height:44px}.nb-row label{display:flex;flex-direction:column;gap:6px;font-size:var(--fs-sm,13px);font-weight:600;color:var(--text-2)}

.nb-note{padding:12px 14px;border-radius:var(--r-sm);background:var(--bg-2);color:var(--text-2);font-size:14px;line-height:1.7;margin:10px 0}.nb-card{padding:14px 16px;border-radius:var(--r);border:1px solid color-mix(in srgb,var(--line) 70%,transparent);margin:0 0 var(--s3);background:var(--card);box-shadow:var(--sh-1)}
.nb-map{position:relative;height:min(58vh,420px);border-radius:var(--r);overflow:hidden;background:var(--bg-2);border:1px solid var(--line);touch-action:none;user-select:none;outline-offset:2px;margin:10px 0}
.nb-map.grid{background-color:var(--bg-2);background-image:linear-gradient(var(--line-2) 1px,transparent 1px),linear-gradient(90deg,var(--line-2) 1px,transparent 1px);background-size:48px 48px}
.nb-tiles{position:absolute;inset:0}.nb-tiles img{position:absolute;width:256px;height:256px;max-width:none;pointer-events:none}
.nb-pin{position:absolute;transform:translate(-50%,-100%);min-width:44px;min-height:44px;border:0;background:none;font-size:var(--fs-3xl);line-height:1;cursor:pointer;padding:0;filter:drop-shadow(0 1px 2px #0006);transition:font-size .15s var(--ease)}.nb-pin:focus-visible{outline:3px solid var(--accent);border-radius:10px}.nb-pin.sel{font-size:34px;z-index:2}
.nb-area{position:absolute;border-radius:50%;background:color-mix(in srgb,var(--accent) 14%,transparent);border:2px dashed color-mix(in srgb,var(--accent) 55%,transparent);transform:translate(-50%,-50%);pointer-events:none}
.nb-ctl{position:absolute;inset-inline-end:8px;top:8px;display:flex;flex-direction:column;gap:6px;z-index:3}.nb-ctl button{width:44px;height:44px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--elev);color:var(--text);font-size:20px;box-shadow:var(--sh-2);cursor:pointer}
.nb-attr{position:absolute;inset-inline-start:0;bottom:0;background:var(--glass);backdrop-filter:blur(6px);color:var(--text-2);font-size:11px;padding:3px 8px;border-start-end-radius:var(--r-xs);z-index:3}.nb-attr a{color:var(--accent-ink)}
.nb-cross{position:absolute;left:50%;top:50%;transform:translate(-50%,-100%);font-size:30px;pointer-events:none;z-index:2}.nb-here{position:absolute;inset-inline:8px;bottom:26px;display:flex;justify-content:center;z-index:3}.nb-here .btn{min-height:44px;background:var(--elev);color:var(--text);border:1px solid var(--line-2);box-shadow:var(--sh-2)}
.nb-list{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);overflow:hidden}.nb-list:empty{display:none}.nb-list li{display:flex;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);min-height:44px}.nb-list li:last-child{border-bottom:0}.nb-list .ic{font-size:var(--fs-2xl);width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:var(--r-sm);background:var(--bg-2)}.nb-list .grow{flex:1;min-width:0}.nb-list .grow b,.nb-list .grow strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nb-list a{color:inherit;text-decoration:none}.nb-list li.sel{background:var(--accent2)}

.nb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:10px 0}.nb-grid a{padding:14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1);color:var(--text);text-decoration:none;min-height:44px;font-weight:600}.nb-grid a:hover{border-color:var(--accent)}
.nb-st{display:inline-block;font-size:var(--fs-xs);font-weight:600;padding:2px 10px;border-radius:999px;background:var(--bg-2);color:var(--text-2)}.nb-st.pending,.nb-st.review{background:color-mix(in srgb,var(--warn) 18%,transparent);color:color-mix(in srgb,var(--warn) 55%,var(--text))}.nb-st.rejected{background:color-mix(in srgb,var(--danger) 16%,transparent);color:color-mix(in srgb,var(--danger) 65%,var(--text))}.nb-st.approved{background:color-mix(in srgb,var(--ok) 16%,transparent);color:color-mix(in srgb,var(--ok) 55%,var(--text))}
.nb-open{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-sm);font-weight:600;padding:4px 12px;border-radius:999px;background:color-mix(in srgb,var(--ok) 16%,transparent);color:color-mix(in srgb,var(--ok) 55%,var(--text))}.nb-open.no{background:color-mix(in srgb,var(--danger) 14%,transparent);color:color-mix(in srgb,var(--danger) 65%,var(--text))}.nb-open::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.nb-hero{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 10px;color:var(--text-2)}.nb-stars{color:var(--warn);letter-spacing:1px}.nb-rate{display:flex;gap:16px;align-items:center;padding:14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1);margin:8px 0}.nb-rate .big{font-size:36px;font-weight:800;line-height:1}.nb-rate ul{list-style:none;padding:0;margin:0;flex:1}.nb-rate li{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted)}.nb-rate .tr{flex:1;height:6px;border-radius:4px;background:var(--bg-2);overflow:hidden}.nb-rate .tr i{display:block;height:100%;background:var(--warn);border-radius:4px}
.nb-ph{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 0}.nb-ph figure{margin:0;flex:none;width:min(72vw,260px);scroll-snap-align:start;position:relative}.nb-ph img{width:100%;height:170px;object-fit:cover;border-radius:var(--r);display:block;background:var(--bg-2)}.nb-ph figcaption{font-size:12px;color:var(--muted);margin-top:4px}.nb-ph .x{position:absolute;top:6px;inset-inline-end:6px;min-width:44px;min-height:44px;border-radius:50%;border:0;background:#000a;color:var(--white);cursor:pointer}
.nb-ph .add{display:grid;place-items:center;height:170px;border-radius:var(--r);border:2px dashed var(--line-2);color:var(--muted);cursor:pointer;text-align:center;padding:8px;background:var(--card)}.nb-ph .add:hover{border-color:var(--accent);color:var(--accent-ink)}.nb-ph .add input{position:absolute;opacity:0;width:1px;height:1px}
.nb-hours{width:100%;border-collapse:collapse;font-size:14px}.nb-hours td{padding:8px 4px;border-bottom:1px solid var(--line);color:var(--text-2)}.nb-hours tr:last-child td{border-bottom:0}.nb-hours tr.today td{font-weight:700;color:var(--accent-ink)}.nb-hours td:last-child{text-align:end}
.nb-starpick{display:flex;gap:4px}.nb-starpick button{min-width:44px;min-height:44px;font-size:26px;border:0;background:none;color:var(--line-2);cursor:pointer;transition:color .12s}.nb-starpick button.on{color:var(--warn)}
.nb-rv{padding:12px 0;border-bottom:1px solid var(--line)}.nb-rv:last-child{border-bottom:0}.nb-rv p{margin:6px 0 0;line-height:1.75;color:var(--text-2)}.nb-rv .who{display:flex;gap:8px;align-items:center;font-size:var(--fs-sm)}.nb-rv .av{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:var(--white);font-size:var(--fs-sm)}
.nb-wk[hidden]{display:none}.nb-wk{display:grid;grid-template-columns:auto 1fr 1fr auto;gap:6px;align-items:center;font-size:var(--fs-sm)}.nb-wk input[type=time]{min-height:44px}.nb-rsvp{min-height:44px;padding:0 14px;white-space:nowrap}.btn.nb-rsvp[aria-pressed="true"],.btn.ghost.nb-rsvp[aria-pressed="true"]{background:color-mix(in srgb,var(--ok) 62%,#000);color:#fff;border-color:color-mix(in srgb,var(--ok) 62%,#000)}
.nb-f label{display:flex;flex-direction:column;gap:6px;margin:10px 0;font-size:14px;font-weight:600;color:var(--text-2)}.nb-f input,.nb-f select,.nb-f textarea{min-height:44px;width:100%;box-sizing:border-box;font-weight:400}
.nb-sum{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;cursor:pointer;list-style:none}.nb-sum::-webkit-details-marker{display:none}.nb-sum b{white-space:nowrap}details[open]>.nb-sum{margin-bottom:6px}

</style>`);

  /* ---------- geohash (device side) ---------- */
  const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  function geohash(lat, lng, p = 5) { const la = [-90, 90], lo = [-180, 180]; let bit = 0, ch = 0, even = true, out = ""; while (out.length < p) { const r = even ? lo : la, v = even ? lng : lat, mid = (r[0] + r[1]) / 2; if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; } even = !even; if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; } } return out; }
  function deviceCell() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error("متصفحك لا يدعم تحديد الموقع؛ اختر مدينة بدلاً من ذلك"));
      navigator.geolocation.getCurrentPosition((p) => res(geohash(p.coords.latitude, p.coords.longitude, 5)), () => rej(new Error("تعذر تحديد الموقع (لم يُسمح أو غير متاح)؛ اختر مدينة بدلاً من ذلك")), { enableHighAccuracy: false, maximumAge: 10 * 60e3, timeout: 10000 });
    });
  }

  /* ---------- slippy map ---------- */
  const TS = 256, clampLat = (l) => Math.max(-85.0511, Math.min(85.0511, l));
  const wx = (lng, z) => ((lng + 180) / 360) * TS * 2 ** z;
  const wy = (lat, z) => { const s = Math.sin((clampLat(lat) * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TS * 2 ** z; };
  const lngOf = (x, z) => (x / (TS * 2 ** z)) * 360 - 180;
  const latOf = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / (TS * 2 ** z); return (180 / Math.PI) * Math.atan(Math.sinh(n)); };
  /** @param {HTMLElement} el */
  function mountMap(el, o) {
    if (!el) return { set() { }, moveTo() { }, select() { }, center: () => ({ ...o.center, z: o.zoom || 12 }), fit() { }, state: {} }; // the view changed meanwhile
    const C = o.config, st = { lat: o.center.lat, lng: o.center.lng, z: o.zoom || C.defaultZoom || 12, items: o.items || [], sel: null, tiles: !!C.tileUrl, errors: 0, shown: false };
    el.classList.add("nb-map"); el.setAttribute("dir", "ltr"); el.tabIndex = 0; el.setAttribute("role", "region");
    el.setAttribute("aria-label", "خريطة. استخدم الأسهم للتحريك و + أو − للتكبير والتصغير، أو اختر من القائمة أسفلها.");
    el.innerHTML = `<div class="nb-tiles" aria-hidden="true"></div><div class="nb-layer"></div>${o.picker ? `<span class="nb-cross" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-mapPin /></svg></span>` : ""}
      <div class="nb-ctl"><button type="button" data-z="1" aria-label="تكبير">+</button><button type="button" data-z="-1" aria-label="تصغير">−</button></div>
      ${o.onMoveEnd ? `<div class="nb-here" hidden><button type="button" class="btn">ابحث في هذه المنطقة</button></div>` : ""}
      <div class="nb-attr"><a href="${h(C.attributionUrl)}" target="_blank" rel="noopener">${h(C.attribution)}</a></div>`;
    const tl = el.querySelector(".nb-tiles"), layer = el.querySelector(".nb-layer"), here = el.querySelector(".nb-here");
    const size = () => ({ w: el.clientWidth || 320, hh: el.clientHeight || 300 });
    function tilesDraw() {
      if (!st.shown) return;
      if (!st.tiles) { el.classList.add("grid"); tl.innerHTML = ""; return; }
      const { w, hh } = size(), cx = wx(st.lng, st.z), cy = wy(st.lat, st.z), n = 2 ** st.z;
      const x0 = Math.floor((cx - w / 2) / TS), x1 = Math.floor((cx + w / 2) / TS), y0 = Math.max(0, Math.floor((cy - hh / 2) / TS)), y1 = Math.min(n - 1, Math.floor((cy + hh / 2) / TS));
      const want = new Map();
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const xx = ((x % n) + n) % n; want.set(`${st.z}/${xx}/${y}`, { left: Math.round(x * TS - (cx - w / 2)), top: Math.round(y * TS - (cy - hh / 2)) }); }
      for (const img of [...tl.children]) { const p = want.get(img.dataset.k); if (!p) img.remove(); else { img.style.left = p.left + "px"; img.style.top = p.top + "px"; want.delete(img.dataset.k); } }
      for (const [k, p] of want) {
        const [z, x, y] = k.split("/"), img = new Image(); img.alt = ""; img.decoding = "async"; img.dataset.k = k; img.draggable = false;
        img.style.left = p.left + "px"; img.style.top = p.top + "px";
        img.addEventListener("error", () => { if (++st.errors >= 3 && st.tiles) { st.tiles = false; tilesDraw(); o.onFallback?.(); } });
        img.src = C.tileUrl.replace("{z}", z).replace("{x}", x).replace("{y}", y); tl.append(img);
      }
    }
    function pinsDraw() {
      const { w, hh } = size(), cx = wx(st.lng, st.z), cy = wy(st.lat, st.z);
      const pos = (lat, lng) => ({ x: wx(lng, st.z) - cx + w / 2, y: wy(lat, st.z) - cy + hh / 2 });
      let html = "";
      if (o.area) { const c = pos(o.area.lat, o.area.lng), r = (o.area.km * 1000) / ((40075016.686 * Math.cos((o.area.lat * Math.PI) / 180)) / (TS * 2 ** st.z)); html += `<span class="nb-area" style="left:${c.x}px;top:${c.y}px;width:${2 * r}px;height:${2 * r}px" title="منطقتك التقريبية"></span>`; }
      for (const it of st.items) { const p = pos(it.lat, it.lng); if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > hh + 60) continue; html += `<button type="button" class="nb-pin ${st.sel === it.id ? "sel" : ""}" data-pin="${h(it.id)}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px" aria-label="${h(it.name)}${it.distanceKm !== undefined ? "، على بعد نحو " + it.distanceKm + " كم" : ""}">${iconOf(it)}</button>`; }
      layer.innerHTML = html;
    }
    const draw = () => { tilesDraw(); pinsDraw(); };
    let raf = 0; const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    function moveBy(dx, dy) { const x = wx(st.lng, st.z) + dx, y = wy(st.lat, st.z) + dy; st.lng = ((lngOf(x, st.z) + 540) % 360) - 180; st.lat = clampLat(latOf(y, st.z)); redraw(); moved(); }
    function zoom(d) { const z = Math.max(C.minZoom || 3, Math.min(C.maxZoom || 18, st.z + d)); if (z === st.z) return; st.z = z; tl.innerHTML = ""; redraw(); moved(); }
    let mt = 0; function moved() { if (here) here.hidden = false; clearTimeout(mt); mt = setTimeout(() => o.onMove?.({ lat: st.lat, lng: st.lng, z: st.z }), 150); }
    el.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); zoom(+b.dataset.z); }));
    here?.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); here.hidden = true; o.onMoveEnd({ lat: st.lat, lng: st.lng, z: st.z }); });
    layer.addEventListener("click", (e) => { const b = e.target.closest("[data-pin]"); if (!b) return; st.sel = b.dataset.pin; pinsDraw(); o.onSelect?.(st.items.find((x) => x.id === st.sel)); });
    let drag = null;
    el.addEventListener("pointerdown", (e) => { if (e.target.closest("button,a")) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; el.setPointerCapture?.(e.pointerId); });
    el.addEventListener("pointermove", (e) => { if (!drag || drag.id !== e.pointerId) return; const dx = drag.x - e.clientX, dy = drag.y - e.clientY; drag.x = e.clientX; drag.y = e.clientY; moveBy(dx, dy); });
    const up = () => { drag = null; }; el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    el.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) zoom(1); });
    el.addEventListener("keydown", (e) => { const k = { ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] }[e.key]; if (k) { e.preventDefault(); moveBy(k[0], k[1]); } else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1); } else if (e.key === "-") { e.preventDefault(); zoom(-1); } });
    // tiles only once the map is actually on screen (and after layout gives it a size)
    const show = () => { st.shown = true; draw(); };
    if ("IntersectionObserver" in window) { const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { io.disconnect(); show(); } }); io.observe(el); } else show();
    addEventListener("resize", redraw);
    pinsDraw();
    return { set(items) { st.items = items || []; pinsDraw(); }, moveTo(lat, lng, z) { st.lat = lat; st.lng = lng; if (z) st.z = Math.max(C.minZoom || 3, Math.min(C.maxZoom || 18, z)); tl.innerHTML = ""; redraw(); }, select(id) { st.sel = id; const it = st.items.find((x) => x.id === id); if (it) { st.lat = it.lat; st.lng = it.lng; redraw(); } }, center: () => ({ lat: st.lat, lng: st.lng, z: st.z }), state: st, fit(items) { if (!items.length) return; const la = items.map((x) => x.lat), lo = items.map((x) => x.lng), { w, hh } = size(); st.lat = (Math.min(...la) + Math.max(...la)) / 2; st.lng = (Math.min(...lo) + Math.max(...lo)) / 2; for (let z = C.maxZoom || 18; z >= (C.minZoom || 3); z--) { if (wx(Math.max(...lo), z) - wx(Math.min(...lo), z) < w - 60 && wy(Math.min(...la), z) - wy(Math.max(...la), z) < hh - 80) { st.z = Math.min(z, 16); break; } } tl.innerHTML = ""; redraw(); } };
  }

  /* ---------- #/nearby ---------- */
  async function nearbyView() {
    const q = qs(), cfg = await config();
    page("بالقرب منك", `<div id="nb-loc" class="nb-card nb-loc" aria-live="polite"><div class="skel"></div></div>
      <form id="nb-ff" class="nb-row" role="search"><label>البحث<input name="q" type="search" enterkeyhint="search" value="${h(q.get("q") || "")}" placeholder="اسم مكان أو فعالية" maxlength="60"></label>
        <label>التصنيف<select name="category"><option value="">الكل</option>${cfg.categories.map((c) => `<option value="${c.key}" ${q.get("category") === c.key ? "selected" : ""}>${ICON[c.key] || ""} ${h(c.label)}</option>`).join("")}</select></label>
        <label>المسافة<select name="radius" data-fx-def="10">${[2, 5, 10, 25, 50].map((r) => `<option value="${r}" ${String(r) === (q.get("radius") || "10") ? "selected" : ""}>${r} كم</option>`).join("")}</select></label><button class="btn ghost">تطبيق</button></form>
      <div class="nb-chips f-chips" role="group" aria-label="النوع">${[["", "الكل"], ["events", "فعاليات"], ["places", "أماكن"]].map(([k, l]) => `<button type="button" class="chip f" data-kind="${k}" aria-pressed="${(q.get("kinds") || "") === k}">${l}</button>`).join("")}</div>
      <div id="nb-map"></div><div id="nb-sel"></div><div id="nb-res" aria-live="polite"><div class="skel"></div></div>
      <h3 class="f-h">أماكنك</h3><div class="list">${UI.li({ href: "#/places/saved", icon: "star", title: "المحفوظة" })}${UI.li({ href: "#/places/mine", icon: "mapPin", title: "أماكني" })}${UI.li({ href: "#/cities", icon: "building", title: "المدن" })}</div><a class="btn block" href="#/places/new"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>أضف مكاناً عاماً</a>`, ["#/explore", "استكشف"]);
    const params = () => { const p = qs(), o = new URLSearchParams(); for (const k of ["city", "area", "q", "category", "radius", "kinds", "place"]) if (p.get(k)) o.set(k, p.get(k)); return o; };
    const go = (patch) => { const p = qs(); for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") p.delete(k); else p.set(k, v); } location.hash = "#/nearby" + (p.toString() ? "?" + p.toString() : ""); };
    { const F = $("#nb-ff"); if (F && window.MPFeat) MPFeat.filters({ host: F, form: F, move: [...F.querySelectorAll(":scope > label:not(:first-child), :scope > button")], defaults: { radius: "10" } }); }
    $("#nb-ff")?.addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); go({ q: f.get("q").trim(), category: f.get("category"), radius: f.get("radius") }); });
    view.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => go({ kinds: b.dataset.kind })));
    // location card
    let me = null; if (DB.me) { try { me = await api("GET", "/api/nearby/location"); } catch { me = null; } }
    let d; try { d = await api("GET", "/api/nearby?" + params().toString()); } catch (e) { if (!$("#nb-res")) return; $("#nb-res").innerHTML = errBox(e); return; }
    const cityOpts = (sel) => d.cities.map((c) => `<option value="${h(c.name)}" ${c.name === sel ? "selected" : ""}>${h(c.name)}</option>`).join("");
    const L = $("#nb-loc"); if (!L) return; // the view changed while loading
    if (!me || !me.allowed) L.innerHTML = `<div class="nb-lh">${UI.icon("mapPin")}<div><b>${me?.minor ? h(me.note) : "اختر مدينة لتصفح ما فيها"}</b></div></div><div class="nb-row"><label>المدينة<select id="nb-city"><option value="">اختر…</option>${cityOpts(d.center?.city)}</select></label></div>`;
    else if (me.enabled) L.innerHTML = `<div class="nb-lh">${UI.icon("mapPin")}<div><b>${h(me.city || "منطقتك التقريبية")}</b><small>${me.geohash ? `منطقة تقريبية · نحو ${UI.num(me.cell?.kmAcross || 5)} كم` : "مدينة"}</small></div><button type="button" class="btn outline sm" id="nb-off">إيقاف وحذف موقعي</button></div>
      <div class="nb-row"><label>مدينة أخرى<select id="nb-city"><option value="">—</option>${cityOpts(q.get("city"))}</select></label></div>`;
    else L.innerHTML = `<div class="nb-lh">${UI.icon("mapPin")}<div><b>اعرض ما حولك</b><small>منطقة تقريبية نحو ${UI.num(5)} كم — لا يُرسل موقعك الدقيق ولا يُحفظ.</small></div></div>
      <div class="nb-row nb-lr"><button type="button" class="btn" id="nb-dev">${UI.icon("target", "sm")} استخدم موقعي</button><select id="nb-city" aria-label="أو اختر مدينة"><option value="">أو اختر مدينة…</option>${cityOpts(d.center?.city)}</select></div>
      <label class="switch-row nb-sv"><span>احفظ منطقتي للمرات القادمة</span><input type="checkbox" id="nb-save"></label>`;
    $("#nb-city")?.addEventListener("change", (e) => go({ city: e.target.value, area: null, place: null }));
    $("#nb-off")?.addEventListener("click", async () => { try { await api("DELETE", "/api/nearby/location"); say("حُذف موقعك التقريبي"); go({ area: null }); nearbyView(); } catch (e) { say(e.message); } });
    $("#nb-dev")?.addEventListener("click", async (e) => { const btn = e.currentTarget;
      btn.disabled = true;
      try { const cell = await deviceCell(); if ($("#nb-save").checked) await api("PUT", "/api/nearby/location", { geohash: cell, radiusKm: +(q.get("radius") || 10) }); go({ area: cell, city: null, place: null }); }
      catch (x) { say(x.message); btn.disabled = false; }
    });
    // results
    if (!d.center) { if (!$("#nb-res")) return; $("#nb-res").innerHTML = `<div class="empty">${h(d.note || "اختر مدينة لعرض ما حولك.")}</div>`; return; }
    const items = d.items;
    const list = (sel) => items.length ? `<ul class="nb-list" aria-label="النتائج مرتبة حسب المسافة">${items.map((it) => `<li class="${sel === it.id ? "sel" : ""}" id="nb-i-${h(it.id)}"><span class="ic" aria-hidden="true">${iconOf(it)}</span><a class="grow" href="${it.href}"><b>${h(it.name)}</b><span class="u-db u-t-sm muted">${it.kind === "event" ? `${when(it.startsAt)} · ${h(it.place || "")}` : `${h(it.categoryLabel)}${it.address ? " · " + h(it.address) : ""}`}</span></a><span class="u-t-sm u-nw muted">${km(it.distanceKm)}</span>${it.kind === "event" ? `<span class="u-dflex u-fdc u-aic u-g2">${rsvpBtn(it)}</span>` : ""}</li>`).join("")}</ul>` : `<div class="empty">لا شيء ضمن ${d.radiusKm} كم. جرّب مسافة أكبر أو <a href="#/places/new">أضف مكاناً</a>.</div>`;
    if (!$("#nb-res")) return; $("#nb-res").innerHTML = `<p class="u-t-sm muted">حول <b>${h(d.center.label)}</b>${d.center.approx ? " (تقريبي)" : ""} ضمن ${d.radiusKm} كم: ${d.counts.events} فعالية و${d.counts.places} مكان.</p>${list()}`; wireRsvp($("#nb-res"));
    const map = mountMap($("#nb-map"), { config: cfg, center: d.center, zoom: d.radiusKm <= 2 ? 14 : d.radiusKm <= 5 ? 13 : d.radiusKm <= 10 ? 12 : d.radiusKm <= 25 ? 11 : 10, items, area: d.center.approx && (d.center.source === "device" || d.center.source === "saved") ? { lat: d.center.lat, lng: d.center.lng, km: 2.5 } : null,
      onFallback: () => { if (!$("#nb-sel")) return; $("#nb-sel").innerHTML = `<div class="nb-note">تعذر تحميل الخريطة التفصيلية؛ تُعرض المواقع نسبياً على شبكة. القائمة أدناه كاملة.</div>`; },
      onSelect: (it) => { if (!it) return; if (!$("#nb-sel")) return; $("#nb-sel").innerHTML = `<div class="nb-card" role="status"><b>${iconOf(it)} ${h(it.name)}</b> <span class="muted">${km(it.distanceKm)}</span><div class="u-t-sm muted">${it.kind === "event" ? when(it.startsAt) : h(it.categoryLabel)}</div><div class="nb-row"><a class="btn" href="${it.href}">التفاصيل</a>${rsvpBtn(it)}</div></div>`; wireRsvp($("#nb-sel")); view.querySelectorAll(".nb-list li").forEach((li) => li.classList.toggle("sel", li.id === "nb-i-" + it.id)); },
      onMoveEnd: (c) => go({ area: geohash(c.lat, c.lng, 5), city: null, place: null }) });
    window.MPNearby.map = map;
  }

  /* ---------- #/place/:id ---------- */
  async function placeView(id) {
    page("المكان", `<div id="nb-p"><div class="skel"></div></div>`, ["#/nearby", "بالقرب منك"]);
    let d, cfg; try { [d, cfg] = await Promise.all([api("GET", "/api/places/" + enc(id)), config()]); } catch (e) { if (!$("#nb-p")) return; $("#nb-p").innerHTML = errBox(e); return; }
    const p = d.place; if (p.business && p.status === "approved") { location.replace("#/biz/" + enc(id)); return; } // v2.30: businesses have their own page (phase 67)
    if ($("#nb-h")) $("#nb-h").textContent = `${iconOf(p)} ${p.name}`;
    const STL = { pending: "بانتظار المراجعة", review: "مخفي للمراجعة بعد بلاغات", rejected: "مرفوض", approved: "معتمد", removed: "محذوف" };
    const R = p.rating, today = new Date().getDay(), live = p.status === "approved", signed = !!DB.me;
    if (!$("#nb-p")) return; $("#nb-p").innerHTML = `${p.status !== "approved" ? `<div class="nb-note"><span class="nb-st ${p.status}">${STL[p.status] || p.status}</span>${p.reviewNote ? ` — ${h(p.reviewNote)}` : ""}</div>` : ""}
      <div class="nb-hero"><span class="nb-st">${h(p.categoryLabel)}</span>${p.city ? `<a href="#/city/${enc(p.city)}">${h(p.city)}</a>` : ""}${openChip(p.openNow)}${R && R.count ? `<span>${stars(R.avg)} <b><bdi dir="ltr">${R.avg}</bdi></b> <span class="muted">(${R.count})</span></span>` : ""}</div>
      ${p.descr ? `<p class="u-lh18">${h(p.descr)}</p>` : ""}
      ${live ? `<div class="nb-row">${signed ? `<button type="button" class="btn ghost" id="nb-save" aria-pressed="${!!p.saved}">${p.saved ? "محفوظ" : "☆ حفظ"}</button>` : ""}<button type="button" class="btn ghost" id="nb-share">↗ مشاركة</button><a class="btn ghost" href="https://www.openstreetmap.org/directions?to=${p.lat}%2C${p.lng}" target="_blank" rel="noopener">الاتجاهات</a></div>` : ""}
      ${live ? `<section aria-labelledby="nb-phh"><h3 id="nb-phh" class="u-t-lg">الصور</h3><div class="nb-ph" id="nb-ph"></div></section>` : ""}
      <ul class="nb-list">${p.address ? `<li><span class="ic"><svg class=ix aria-hidden=true><use href=#i-home /></svg></span><span class="grow">${h(p.address)}</span></li>` : ""}${p.hours && !p.hoursTable ? `<li><span class="ic"><svg class=ix aria-hidden=true><use href=#i-clock /></svg></span><span class="grow">${h(p.hours)}</span></li>` : ""}${p.url ? `<li><span class="ic"><svg class=ix aria-hidden=true><use href=#i-link /></svg></span><a class="grow" href="${h(p.url)}" target="_blank" rel="noopener nofollow ugc" dir="ltr">${h(p.url.replace(/^https:\/\//, ""))}</a></li>` : ""}</ul>
      ${p.hoursTable ? `<details class="nb-card" ${p.openNow ? "" : "open"}><summary class="nb-sum"><b><svg class=ix aria-hidden=true><use href=#i-clock /></svg> ساعات العمل</b>${openChip(p.openNow)}</summary><table class="nb-hours"><tbody>${p.hoursTable.map((r, i) => `<tr class="${i === today ? "today" : ""}"><td>${h(r.day)}</td><td><bdi dir="ltr">${h(r.hours)}</bdi></td></tr>`).join("")}</tbody></table>${p.hours ? `<p class="u-t-sm u-m0 u-mt6 muted">${h(p.hours)}</p>` : ""}</details>` : ""}
      <div id="nb-pm"></div><div class="nb-row"><a class="btn ghost" href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}" target="_blank" rel="noopener">افتح في OpenStreetMap</a><a class="btn ghost" href="#/nearby?place=${enc(p.id)}&radius=5">ما حوله</a>
        ${p.mine && p.status !== "approved" ? `<a class="btn ghost" href="#/places/edit/${enc(p.id)}">تعديل</a><button type="button" class="btn ghost" id="nb-del">سحب المكان</button>` : ""}${!p.mine && p.status === "approved" && DB.me ? `<button type="button" class="btn ghost" id="nb-rep">${p.reported ? "تم الإبلاغ" : "إبلاغ"}</button>` : ""}</div>
      ${live ? `<section aria-labelledby="nb-rvh"><h3 id="nb-rvh" class="u-t-lg">التقييمات</h3><div id="nb-rv"></div></section>` : ""}
      ${d.nearbyEvents.length ? `<h3>فعاليات قريبة</h3><ul class="nb-list">${d.nearbyEvents.map((e) => `<li><span class="ic"><svg class=ix aria-hidden=true><use href=#i-cal /></svg></span><a class="grow" href="${e.href}"><b>${h(e.name)}</b><span class="u-db u-t-sm muted">${when(e.startsAt)}</span></a><span class="muted">${km(e.distanceKm)}</span>${rsvpBtn(e)}</li>`).join("")}</ul>` : ""}`;
    wireRsvp($("#nb-p"));
    if (live) { drawPhotos(p); drawReviews(p); }
    $("#nb-share")?.addEventListener("click", () => shareLink("#/place/" + enc(p.id), p.name));
    $("#nb-save")?.addEventListener("click", async (e) => { const b = e.currentTarget, on = b.getAttribute("aria-pressed") !== "true"; try { await api(on ? "PUT" : "DELETE", `/api/places/${enc(p.id)}/save`); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "محفوظ" : "☆ حفظ"; say(on ? "حُفظ في أماكنك المفضلة" : "أُزيل من المحفوظة"); } catch (x) { say(x.message); } });
    if (!$("#nb-pm")) return; $("#nb-pm").style.height = "220px";
    mountMap($("#nb-pm"), { config: cfg, center: p, zoom: 16, items: [p] });
    $("#nb-del")?.addEventListener("click", async () => { if (!confirm("سحب هذا المكان؟")) return; try { await api("DELETE", "/api/places/" + enc(p.id)); say("سُحب المكان"); location.hash = "#/places/mine"; } catch (e) { say(e.message); } });
    $("#nb-rep")?.addEventListener("click", () => {
      if (p.reported) return say("أبلغت عن هذا المكان من قبل");
      sheet(`<h4 class="u-mt0">الإبلاغ عن ${h(p.name)}</h4><form id="nb-rf" class="nb-f">${Object.entries(d.reasons).map(([k, l], i) => `<label class="chk" style="flex-direction:row;gap:8px;align-items:center;min-height:44px"><input type="radio" name="reason" value="${k}" ${i ? "" : "checked"}> ${h(l)}</label>`).join("")}<label>ملاحظة (اختياري)<input name="note" maxlength="300"></label><button class="btn block">إرسال البلاغ</button></form>`);
      document.getElementById("nb-rf").addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { const r = await api("POST", `/api/places/${enc(p.id)}/report`, { reason: f.get("reason"), note: f.get("note") }); closeSheet(); say(r.hidden ? "شكراً — أُخفي المكان حتى يراجعه المشرفون" : "شكراً، وصل بلاغك"); placeView(id); } catch (x) { say(x.message); } });
    });
  }

  function drawPhotos(p) {
    const box = $("#nb-ph"); if (!box) return;
    const mine = p.photos.filter((x) => x.mine).length;
    box.innerHTML = `${p.photos.map((x) => `<figure><img src="${h(x.url)}" alt="${h(x.caption || "صورة " + p.name)}" loading="lazy" decoding="async">${x.caption ? `<figcaption>${h(x.caption)}</figcaption>` : ""}${x.mine ? `<button type="button" class="x" data-phdel="${h(x.id)}" aria-label="حذف صورتي">✕</button>` : ""}</figure>`).join("")}
      ${DB.me && mine < 3 && p.photos.length < 24 ? `<figure><label class="add"><svg class=ix aria-hidden=true><use href=#i-camera /></svg><br>أضف صورة للمكان<input type="file" accept="image/*" id="nb-phf"></label></figure>` : ""}${!p.photos.length && !DB.me ? `<p class="muted">لا صور بعد.</p>` : ""}`;
    $("#nb-phf")?.addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return; if (f.size > 8 * 1048576) return say("حجم الصورة كبير (٨ ميغابايت كحد أقصى)");
      const lab = e.target.closest("label"); lab.textContent = "جارٍ الرفع…";
      try { const m = (await Remote.api("POST", "/api/media", null, f)).media; const caption = (prompt("وصف قصير للصورة (اختياري)") || "").trim(); const r = await api("POST", `/api/places/${enc(p.id)}/photos`, { media: m.id, caption: caption || undefined }); Object.assign(p, { photos: r.photos }); say("أُضيفت الصورة"); }
      catch (x) { say(x.message); } drawPhotos(p);
    });
    box.querySelectorAll("[data-phdel]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("حذف صورتك؟")) return; try { await api("DELETE", `/api/places/${enc(p.id)}/photos/${enc(b.dataset.phdel)}`); p.photos = p.photos.filter((x) => x.id !== b.dataset.phdel); drawPhotos(p); } catch (x) { say(x.message); } }));
  }
  function drawReviews(p) {
    const box = $("#nb-rv"); if (!box) return;
    const R = p.rating, my = p.myReview, canRate = DB.me && !p.mine;
    let pick = my?.rating || 0;
    box.innerHTML = `${R.count ? `<div class="nb-rate"><div class="u-tc"><div class="big"><bdi dir="ltr">${R.avg}</bdi></div>${stars(R.avg)}<div class="u-t-xs muted">${R.count} تقييم</div></div><ul aria-label="توزيع التقييمات">${[5, 4, 3, 2, 1].map((n) => `<li><span><bdi dir="ltr">${n}</bdi>★</span><span class="tr"><i style="width:${R.count ? Math.round((R.dist[n - 1] / R.count) * 100) : 0}%"></i></span><span class="muted"><bdi dir="ltr">${R.dist[n - 1]}</bdi></span></li>`).join("")}</ul></div>` : `<p class="muted">لا تقييمات بعد${canRate ? " — كن أول من يقيّم." : "."}</p>`}
      ${canRate ? `<form id="nb-rf2" class="nb-card nb-f"><b>${my ? "تقييمك" : "قيّم المكان"}</b><div class="nb-starpick" role="radiogroup" aria-label="عدد النجوم">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-st="${n}" aria-checked="${n === pick}" aria-label="${n} من ٥" class="${n <= pick ? "on" : ""}">★</button>`).join("")}</div>
        <label>رأيك (اختياري)<textarea name="text" maxlength="500" rows="3" placeholder="ما الذي أعجبك؟ ما الذي يحتاج تحسيناً؟">${h(my?.text || "")}</textarea></label>${my?.status === "hidden" ? `<p class="u-t-sm muted">نصّ مراجعتك مخفي لأنه يخالف الإرشادات؛ تقييمك بالنجوم محسوب.</p>` : ""}<div class="nb-row"><button class="btn">${my ? "تحديث" : "نشر التقييم"}</button>${my ? `<button type="button" class="btn ghost" id="nb-unrate">حذف تقييمي</button>` : ""}</div></form>` : ""}
      ${p.reviews.length ? p.reviews.map((r) => `<div class="nb-rv"><div class="who"><span class="av" style="background:${h(r.author.color || "#7c3aed")}" aria-hidden="true">${h((r.author.name || "؟")[0])}</span><b>${h(r.author.name)}</b>${stars(r.rating)}<span class="muted">${h(new Date(r.at).toLocaleDateString("ar-u-nu-latn", { day: "numeric", month: "short", year: "numeric" }))}</span></div><p>${h(r.text)}</p></div>`).join("") : ""}`;
    box.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => { pick = +b.dataset.st; box.querySelectorAll("[data-st]").forEach((x) => { x.classList.toggle("on", +x.dataset.st <= pick); x.setAttribute("aria-checked", String(+x.dataset.st === pick)); }); }));
    $("#nb-rf2")?.addEventListener("submit", async (e) => { e.preventDefault(); if (!pick) return say("اختر عدد النجوم"); try { const r = await api("POST", `/api/places/${enc(p.id)}/reviews`, { rating: pick, text: new FormData(e.target).get("text").trim() || undefined }); Object.assign(p, r); say(r.reviewStatus === "hidden" ? "حُفظ تقييمك؛ النص بانتظار المراجعة" : "شكراً لتقييمك"); drawReviews(p); } catch (x) { say(x.message); } });
    $("#nb-unrate")?.addEventListener("click", async () => { try { await api("DELETE", `/api/places/${enc(p.id)}/reviews`); const d = await api("GET", "/api/places/" + enc(p.id)); Object.assign(p, d.place); drawReviews(p); } catch (x) { say(x.message); } });
  }
  async function savedView() {
    page("أماكني المفضلة", `<div id="nb-sv"><div class="skel"></div></div>`, ["#/nearby", "بالقرب منك"]);
    if (!DB.me) { $("#nb-sv").innerHTML = `<div class="empty">سجّل الدخول لحفظ الأماكن.</div>`; return; }
    let d; try { d = await api("GET", "/api/places/saved"); } catch (e) { if (!$("#nb-sv")) return; $("#nb-sv").innerHTML = errBox(e); return; }
    if (!$("#nb-sv")) return; $("#nb-sv").innerHTML = d.places.length ? `<ul class="nb-list">${d.places.map((p) => `<li><span class="ic">${iconOf(p)}</span><a class="grow" href="#/place/${enc(p.id)}"><b>${h(p.name)}</b><span class="u-db u-t-sm muted">${h(p.categoryLabel)}${p.city ? " · " + h(p.city) : ""}</span></a>${openChip(p.openNow)}</li>`).join("")}</ul>` : `<div class="empty"><div style="font-size:32px" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-star /></svg></div><p>احفظ أماكنك المفضلة — المسجد القريب، مقهى الدراسة، المكتبة — لتجدها بسرعة.</p><a class="btn" href="#/nearby">استكشف ما حولك</a></div>`;
  }

  /* ---------- #/places/new  #/places/edit/:id ---------- */
  async function placeForm(editId) {
    const cfg = await config();
    if (!DB.me) { page("إضافة مكان", `<div class="empty">سجّل الدخول لإضافة مكان.</div>`, ["#/nearby", "بالقرب منك"]); return; }
    let cur = null; if (editId) { try { cur = (await api("GET", "/api/places/" + enc(editId))).place; } catch (e) { page("تعديل المكان", errBox(e), ["#/places/mine", "أماكني"]); return; } }
    page(editId ? "تعديل المكان" : "إضافة مكان عام", `<div class="nb-note">أضف أماكن <b>عامة</b> فقط (مسجد، مقهى، مكتبة، حديقة…). لا تضف منازل أو أماكن خاصة. يراجع المشرفون كل إضافة قبل ظهورها.</div>
      <form id="nb-pf" class="nb-f"><label>الاسم<input name="name" required minlength="2" maxlength="80" value="${h(cur?.name || "")}"></label>
      <label>التصنيف<select name="category" required><option value="">اختر…</option>${cfg.categories.map((c) => `<option value="${c.key}" ${cur?.category === c.key ? "selected" : ""}>${ICON[c.key] || ""} ${h(c.label)}</option>`).join("")}</select></label>
      <label>وصف قصير<textarea name="descr" maxlength="500" rows="3">${h(cur?.descr || "")}</textarea></label>
      <label>العنوان<input name="address" maxlength="200" value="${h(cur?.address || "")}"></label><div class="nb-row"><button type="button" class="btn ghost" id="nb-geo"><svg class=ix aria-hidden=true><use href=#i-search /></svg> ابحث عن العنوان على الخريطة</button></div><div id="nb-gr"></div>
      <p class="u-t-sm muted">حرّك الخريطة حتى يقع الدبوس على المكان تماماً.</p><div id="nb-pk"></div>
      <fieldset class="u-my8 nb-card"><legend><b><svg class=ix aria-hidden=true><use href=#i-clock /></svg> ساعات العمل</b> <span class="u-t-sm muted">(اختياري — تُظهر «مفتوح الآن»)</span></legend>
        <div class="nb-row"><label class="chk" style="flex-direction:row;align-items:center;gap:6px;min-height:44px"><input type="checkbox" id="nb-wk-on" ${cur?.hoursWeek ? "checked" : ""}> حدّد الساعات لكل يوم</label><button type="button" class="btn ghost" id="nb-wk-copy">نسخ الأحد لكل الأيام</button></div>
        <div class="nb-wk" id="nb-wk" ${cur?.hoursWeek ? "" : "hidden"}>${["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"].map((dn, i) => { const x = cur?.hoursWeek?.[i]; return `<span>${dn}</span><input type="time" data-wo="${i}" value="${x ? x[0] : "08:00"}" aria-label="يفتح ${dn}" ${x === null && cur?.hoursWeek ? "disabled" : ""}><input type="time" data-wc="${i}" value="${x ? x[1] : "22:00"}" aria-label="يغلق ${dn}" ${x === null && cur?.hoursWeek ? "disabled" : ""}><label class="chk" style="flex-direction:row;gap:4px;align-items:center;min-height:44px"><input type="checkbox" data-wx="${i}" ${x === null && cur?.hoursWeek ? "checked" : ""}> مغلق</label>`; }).join("")}</div>
        <label>ملاحظة عن الساعات (اختياري)<input name="hours" maxlength="120" value="${h(cur?.hours || "")}" placeholder="مثال: يغلق وقت صلاة الجمعة"></label></fieldset><label>رابط (اختياري، https)<input name="url" type="url" dir="ltr" maxlength="300" value="${h(cur?.url || "")}" placeholder="https://"></label>
      <button class="btn block">${editId ? "حفظ وإعادة الإرسال للمراجعة" : "إرسال للمراجعة"}</button></form>`, editId ? ["#/place/" + enc(editId), "المكان"] : ["#/nearby", "بالقرب منك"]);
    let start = cur ? { lat: cur.lat, lng: cur.lng } : null;
    if (!start) { try { const n = await api("GET", "/api/nearby" + (qs().get("city") ? "?city=" + enc(qs().get("city")) : "")); if (n.center) start = n.center; } catch { /* no centre */ } }
    const picker = mountMap($("#nb-pk"), { config: cfg, center: start || { lat: 21.4858, lng: 39.1925 }, zoom: start ? 16 : 11, items: [], picker: true });
    $("#nb-wk-on")?.addEventListener("change", (e) => { $("#nb-wk").hidden = !e.target.checked; });
    view.querySelectorAll("[data-wx]").forEach((x) => x.addEventListener("change", () => { const i = x.dataset.wx; $(`[data-wo="${i}"]`).disabled = $(`[data-wc="${i}"]`).disabled = x.checked; }));
    $("#nb-wk-copy")?.addEventListener("click", () => { $("#nb-wk-on").checked = true; $("#nb-wk").hidden = false; for (let i = 1; i < 7; i++) { $(`[data-wo="${i}"]`).value = $('[data-wo="0"]').value; $(`[data-wc="${i}"]`).value = $('[data-wc="0"]').value; } });
    $("#nb-geo")?.addEventListener("click", async () => {
      const q = $("#nb-pf").address.value.trim() || $("#nb-pf").name.value.trim(); if (q.length < 3) return say("اكتب العنوان أولاً");
      try { const r = await api("GET", "/api/geocode?q=" + enc(q)); if (!$("#nb-gr")) return; $("#nb-gr").innerHTML = r.results.length ? `<ul class="nb-list">${r.results.map((x, i) => `<li><button type="button" class="u-ts btn ghost" data-g="${i}">${h(x.name)}</button></li>`).join("")}</ul>` : `<p class="muted">لا نتائج؛ حرّك الخريطة يدوياً.</p>`;
        $("#nb-gr")?.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => { const x = r.results[+b.dataset.g]; picker.moveTo(x.lat, x.lng, 17); if (!$("#nb-gr")) return; $("#nb-gr").innerHTML = ""; }));
      } catch (e) { say(e.message); }
    });
    $("#nb-pf")?.addEventListener("submit", async (e) => {
      e.preventDefault(); const f = new FormData(e.target), c = picker.center();
      const body = { name: f.get("name").trim(), category: f.get("category"), descr: f.get("descr").trim(), address: f.get("address").trim(), hours: f.get("hours").trim() || null, url: f.get("url").trim() || null, lat: c.lat, lng: c.lng,
        hoursWeek: $("#nb-wk-on")?.checked ? [0, 1, 2, 3, 4, 5, 6].map((i) => ($(`[data-wx="${i}"]`).checked ? null : [$(`[data-wo="${i}"]`).value, $(`[data-wc="${i}"]`).value])) : null };
      try { const r = editId ? await api("PATCH", "/api/places/" + enc(editId), body) : await api("POST", "/api/places", body); say(r.place.status === "rejected" ? "رُفض تلقائياً لمخالفة الإرشادات" : "أُرسل للمراجعة — سنخبرك عند الموافقة"); location.hash = "#/place/" + enc(r.place.id); }
      catch (x) { say(x.code === "duplicate" ? "هذا المكان موجود بالفعل على الخريطة" : x.message); }
    });
  }

  /* ---------- #/places/mine ---------- */
  async function mineView() {
    page("أماكني", `<div id="nb-m"><div class="skel"></div></div><div class="nb-row"><a class="btn" href="#/places/new"><svg class=ix aria-hidden=true><use href=#i-plus /></svg> أضف مكاناً</a></div>`, ["#/nearby", "بالقرب منك"]);
    let d; try { d = await api("GET", "/api/places/mine"); } catch (e) { if (!$("#nb-m")) return; $("#nb-m").innerHTML = errBox(e); return; }
    const STL = { pending: "بانتظار المراجعة", review: "قيد المراجعة", rejected: "مرفوض", approved: "معتمد" };
    if (!$("#nb-m")) return; $("#nb-m").innerHTML = d.places.length ? `<ul class="nb-list">${d.places.map((p) => `<li><span class="ic">${iconOf(p)}</span><a class="grow" href="#/place/${enc(p.id)}"><b>${h(p.name)}</b><span class="u-db u-t-sm muted">${h(p.categoryLabel)}${p.reviewNote ? " · " + h(p.reviewNote) : ""}</span></a><span class="nb-st ${p.status}">${STL[p.status] || p.status}</span></li>`).join("")}</ul>` : `<div class="empty">لم تضف أماكن بعد.</div>`;
  }

  /* ---------- #/cities  #/city/:name ---------- */
  async function citiesView() {
    page("المدن", `<div id="nb-c"><div class="skel"></div></div>`, ["#/nearby", "بالقرب منك"]);
    let d; try { d = await api("GET", "/api/cities"); } catch (e) { if (!$("#nb-c")) return; $("#nb-c").innerHTML = errBox(e); return; }
    const by = {}; for (const c of d.cities) (by[c.countryLabel] ||= []).push(c);
    if (!$("#nb-c")) return; $("#nb-c").innerHTML = Object.entries(by).map(([co, list]) => `<h3>${h(co)}</h3><div class="nb-grid">${list.map((c) => `<a href="#/city/${enc(c.name)}"><b>${h(c.name)}</b><span class="u-db u-t-xs muted">${c.places} مكان</span></a>`).join("")}</div>`).join("");
  }
  async function cityView(name) {
    page(h(decodeURIComponent(name || "")), `<div id="nb-cy"><div class="skel"></div><div class="skel"></div></div>`, ["#/cities", "المدن"]);
    let d; try { d = await api("GET", "/api/cities/" + enc(decodeURIComponent(name || ""))); } catch (e) { if (!$("#nb-cy")) return; $("#nb-cy").innerHTML = errBox(e); return; }
    if ($("#nb-h")) $("#nb-h").textContent = `${d.city}`;
    if (!$("#nb-cy")) return; $("#nb-cy").innerHTML = `<p class="muted">${h(d.countryLabel)}</p><div class="nb-row"><a class="btn" href="${d.mapHref}"><svg class=ix aria-hidden=true><use href=#i-mapPin /></svg> على الخريطة</a><button type="button" class="btn ghost" id="nb-cshare">↗ شارك صفحة ${h(d.city)}</button><a class="btn ghost" href="#/places/new?city=${enc(d.city)}">أضف مكاناً هنا</a></div>
      <h3>الرائج في ${h(d.city)}</h3>${d.trends.length ? `<div class="nb-chips">${d.trends.map((t) => `<a class="btn ghost" href="#/tag/${enc(t.tag)}">#${h(t.tag)}</a>`).join("")}</div>` : `<p class="muted">لا يوجد رائج محلي الآن. <a href="#/explore">استكشف الرائج</a></p>`}
      <h3>فعاليات قادمة</h3>${d.events.length ? `<ul class="nb-list">${d.events.map((e) => `<li><span class="ic"><svg class=ix aria-hidden=true><use href=#i-cal /></svg></span><a class="grow" href="${e.href}"><b>${h(e.name)}</b><span class="u-db u-t-sm muted">${when(e.startsAt)} · ${h(e.place || "")}</span></a></li>`).join("")}</ul>` : `<p class="muted">لا فعاليات مثبّتة على الخريطة قريباً.</p>`}
      <h3>أماكن</h3>${d.categories.length ? `<div class="nb-chips">${d.categories.map((c) => `<a class="btn ghost" href="#/nearby?city=${enc(d.city)}&category=${c.key}&radius=50">${ICON[c.key] || ""} ${h(c.label)} (${c.count})</a>`).join("")}</div><ul class="nb-list">${d.places.slice(0, 12).map((p) => `<li><span class="ic">${iconOf(p)}</span><a class="grow" href="#/place/${enc(p.id)}"><b>${h(p.name)}</b><span class="u-db u-t-sm muted">${h(p.categoryLabel)}</span></a></li>`).join("")}</ul>` : `<p class="muted">لم تُضف أماكن بعد.</p>`}
      ${d.communities.length ? `<h3>مجتمعات محلية</h3><ul class="nb-list">${d.communities.map((c) => `<li><span class="ic"><svg class=ix aria-hidden=true><use href=#i-users /></svg></span><a class="grow" href="#/c/${enc(c.id)}"><b>${h(c.name)}</b><span class="u-db u-t-sm muted">${h(c.desc || "")}</span></a></li>`).join("")}</ul>` : ""}`;
    $("#nb-cshare")?.addEventListener("click", () => shareLink("#/city/" + enc(d.city), `${d.city} على مجتمع بلس — فعاليات وأماكن ومجتمعات`));
  }

  /* ---------- #/admin/places ---------- */
  async function adminView() {
    const st = qs().get("status") || "pending";
    page("مراجعة الأماكن", `<div class="nb-chips" role="tablist">${[["pending", "بانتظار المراجعة"], ["review", "مخفية بعد بلاغات"], ["rejected", "مرفوضة"], ["approved", "معتمدة"]].map(([k, l]) => `<a class="btn ghost" href="#/admin/places?status=${k}" ${k === st ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</div><div id="nb-q"><div class="skel"></div></div>`, ["#/admin", "الإدارة"]);
    let d; try { d = await api("GET", "/api/admin/places?status=" + enc(st)); } catch (e) { if (!$("#nb-q")) return; $("#nb-q").innerHTML = errBox(e); return; }
    if (!$("#nb-q")) return; $("#nb-q").innerHTML = d.places.length ? d.places.map((p) => `<div class="nb-card" id="nb-q-${h(p.id)}"><b>${iconOf(p)} ${h(p.name)}</b> <span class="nb-st">${h(p.categoryLabel)}</span> ${p.risk >= 0.5 ? `<span class="nb-st rejected">خطورة ${Math.round(p.risk * 100)}%</span>` : ""}
      <div class="u-t-sm muted">${h(p.city || "")} · أضافه <bdi dir="ltr">@${h(p.submittedBy.handle || "?")}</bdi>${p.reasons.length ? " · " + h(p.reasons.join("، ")) : ""}</div>${p.descr ? `<p class="u-my6">${h(p.descr)}</p>` : ""}${p.address ? `<div class="u-t-sm muted">${h(p.address)}</div>` : ""}
      ${p.reportReasons.length ? `<div class="nb-note">البلاغات: ${p.reportReasons.map((r) => `${h(r.label)} (${r.n})`).join("، ")}</div>` : ""}
      <div class="nb-row"><a class="btn ghost" href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}" target="_blank" rel="noopener">الموقع</a><label class="grow">ملاحظة للعضو<input data-note="${h(p.id)}" maxlength="300"></label><button type="button" class="btn" data-rv="approve" data-id="${h(p.id)}">قبول</button><button type="button" class="btn ghost" data-rv="reject" data-id="${h(p.id)}">رفض</button></div></div>`).join("") : `<div class="empty">لا شيء هنا</div>`;
    view.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", async () => { try { await api("POST", `/api/admin/places/${enc(b.dataset.id)}/review`, { decision: b.dataset.rv, note: view.querySelector(`[data-note="${b.dataset.id}"]`)?.value || "" }); document.getElementById("nb-q-" + b.dataset.id)?.remove(); say(b.dataset.rv === "approve" ? "قُبل المكان" : "رُفض المكان"); } catch (e) { say(e.message); } }));
  }

  MPRoutes.extend((a, b, prev) => {
    return { nearby: () => nearbyView(), place: () => placeView(a), places: () => (a === "new" ? placeForm() : a === "edit" ? placeForm(b) : a === "saved" ? savedView() : mineView()), cities: () => citiesView(), city: () => (a ? cityView(a) : citiesView()) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "places" ? adminView() : next()));
  window.MPNearby = { nearbyView, placeView, placeForm, mineView, citiesView, cityView, adminView, mountMap, geohash, version: "__APP_VERSION__" };
  if (/^#\/(nearby|place|places|cities|city|admin\/places)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
