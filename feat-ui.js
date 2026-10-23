/* v2.34 D4: shared helpers for feature modules (lazy "feat" chunk, loaded before any feature chunk by chunks.js).
 * 1) Extra line icons appended to the core sprite (kept out of core JS): MPFeat.ico(name, cls).
 * 2) Filter sheet: one visible search field + a «تصفية» button that opens a bottom sheet holding the other controls.
 *    Controls are moved (not cloned) so ids, listeners and form ownership stay intact. Styles live in feat.css. */
(function Feat() {
  if (window.MPFeat) return;
  const P = {
    cal: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
    hand: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    box: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
    phone: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
    film: '<path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.18 5.276 3.1 3.899"/>',
    rocket: '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
    gift: '<path d="M12 7v14"/><path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5"/><rect x="3" y="7" width="18" height="4" rx="1"/>',
    sliders: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    /* v2.35 D4B */
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  };
  const sprite = document.querySelector("symbol[id^='i-']")?.parentNode;
  if (sprite) sprite.insertAdjacentHTML("beforeend", Object.entries(P).filter(([k]) => !document.getElementById("i-" + k)).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join(""));
  const ico = (n, c = "") => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  let seq = 0;
  /* filters({ host, move: [elements], form, title, defaults: { name: value } }): host = element the button goes into (the search form/row) */
  function filters({ host, move = [], form = null, title = "تصفية", defaults = {} } = {}) {
    move = move.filter(Boolean); if (!host || !move.length) return null;
    const id = "fx" + (++seq), root = host.closest("#view") || document.body;
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn outline fx-open"; btn.dataset.fx = "open";
    btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-controls", id);
    host.classList.add("fx-host"); host.appendChild(btn);
    const sh = document.createElement("div"); sh.className = "sheet hidden fx-sheet"; sh.id = id;
    sh.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="${id}-h"><div class="sheet-head"><h3 id="${id}-h">${title}</h3><button type="button" class="btn ghost icon" data-fx="x" aria-label="إغلاق">${ico("x")}</button></div><div class="fx-body"></div><div class="sheet-foot"><button type="button" class="btn block" data-fx="ok">عرض النتائج</button><button type="button" class="btn ghost" data-fx="reset">إعادة ضبط</button></div></div>`;
    const body = sh.querySelector(".fx-body"); move.forEach((el) => body.appendChild(el)); root.appendChild(sh);
    const ctl = () => [...body.querySelectorAll("select,input:not([type=hidden]):not([type=checkbox]):not([type=radio])")].filter((c) => !c.closest("[data-fx-skip]"));
    if (form) { if (!form.id) form.id = id + "-f"; ctl().forEach((c) => c.setAttribute("form", form.id)); body.querySelectorAll("button:not([type=button])").forEach((b) => { b.setAttribute("form", form.id); b.hidden = true; }); }
    const active = () => ctl().filter((c) => { const d = defaults[c.name || c.id]; return d !== undefined ? c.value !== String(d) : c.value !== "" && !(c.tagName === "SELECT" && c.selectedIndex === 0 && !c.querySelector("option[value='']")); }).length + body.querySelectorAll(".chip[aria-pressed=true]:not([data-fx-all]),.chip.on:not([data-fx-all]),.chip[aria-current]:not([data-fx-all]),.f-chips>button[aria-pressed=true]").length;
    const paint = () => { const n = active(); btn.innerHTML = `${ico("sliders", "sm")}<span>${title}</span>${n ? `<span class="fx-n">${n}</span>` : ""}`; btn.setAttribute("aria-label", n ? `${title} — ${n} مفعّل` : title); btn.classList.toggle("on", !!n); };
    let last = null;
    const open = () => { last = document.activeElement; sh.classList.remove("hidden"); (body.querySelector("select,input,button") || sh.querySelector("[data-fx=x]")).focus(); };
    const close = (back = true) => { sh.classList.add("hidden"); paint(); if (back) (last && last.isConnected ? last : btn).focus(); };
    btn.addEventListener("click", open);
    sh.addEventListener("click", (e) => {
      const a = e.target.closest("[data-fx]")?.dataset.fx;
      if (e.target === sh || a === "x") return close();
      if (a === "ok") { close(); if (form) form.requestSubmit(); return; }
      if (a === "reset") { ctl().forEach((c) => { const d = defaults[c.name || c.id]; c.value = d !== undefined ? String(d) : c.tagName === "SELECT" ? c.options[0]?.value ?? "" : ""; c.dispatchEvent(new Event("change", { bubbles: true })); }); body.querySelector(".chip[data-fx-all]")?.click(); close(); if (form) form.requestSubmit(); }
    });
    sh.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    body.addEventListener("change", () => paint()); body.addEventListener("click", () => setTimeout(paint));
    paint(); return { open, close, paint, sheet: sh, button: btn };
  }
  window.MPFeat = { ico, filters, icons: Object.keys(P) };
})();
