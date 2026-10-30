/* v2.143 «مسح الأزرار»: in-page check that every visible control on screen actually receives a tap at its own spot.
 * The class of bug it hunts: a button drawn on screen but covered by another layer (the v2.142 cover-photo button sat
 * under the cover image and behind the avatar), so tapping it does nothing.
 * Rules (kept deliberately strict on real covering, lenient on normal scrolling):
 * - controls: button, a[href], [role=button|tab|switch|menuitem|link], summary, input[type=checkbox|radio] / select / textarea / text inputs
 * - only controls the user can see: non-zero box, checkVisibility (opacity/visibility), not inert/aria-hidden/disabled,
 *   centre inside the viewport and inside every clipping (overflow) ancestor
 * - a control passes when ANY of 5 probe points (centre + 4 inner points at 25/75 %) hits the control itself, something
 *   inside it, its <label>, or the label wrapping it
 * - a hit on a fixed/sticky layer (top bar, bottom dock, side rail) that does not contain the control is normal scrolling,
 *   not a bug; the caller scrolls the page so the control gets its own turn in the open area
 * Returns [{ key, sel, text, by }] for controls that are fully blocked. `key` is stable across scroll steps. */
function tapAudit() {
  const SEL = 'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="link"], summary, input:not([type="hidden"]), select, textarea';
  const vw = innerWidth, vh = innerHeight, out = [];
  const pathOf = (el) => { const parts = []; for (let e = el; e && e.nodeType === 1 && parts.length < 5; e = e.parentElement) { let s = e.tagName.toLowerCase(); if (e.id) { s += "#" + e.id; parts.unshift(s); break; } const c = [...e.classList].slice(0, 2).join("."); if (c) s += "." + c; parts.unshift(s); } return parts.join(" > "); };
  const fixedLayer = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === "fixed" || p === "sticky") return x; } return null; };
  const clipped = (el, x, y) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (/(hidden|auto|scroll|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) { const r = a.getBoundingClientRect(); if (x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) return true; } } return false; };
  const okHit = (el, h) => { if (!h) return false; if (h === el || el.contains(h)) return true; const lab = h.closest("label"); if (lab && (lab.control === el || lab.contains(el))) return true; if (el.labels) for (const l of el.labels) if (l.contains(h)) return true; return false; };
  for (const el of document.querySelectorAll(SEL)) {
    if (el.disabled || el.closest("[inert], [aria-hidden='true'], .hidden, [hidden], .sr-only, .visually-hidden")) continue;
    if (el.type === "checkbox" || el.type === "radio") { if (el.getBoundingClientRect().width < 4) continue; } // styled switches hide the native box on purpose; the label is the target
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
    if (clipped(el, cx, cy)) continue;
    const pts = [[cx, cy], [r.left + r.width * 0.25, r.top + r.height * 0.25], [r.left + r.width * 0.75, r.top + r.height * 0.25], [r.left + r.width * 0.25, r.top + r.height * 0.75], [r.left + r.width * 0.75, r.top + r.height * 0.75]];
    // an inline link that wraps across lines has a bounding box wider than its text: probe each line box's centre too
    for (const lr of el.getClientRects()) if (lr.width >= 4 && lr.height >= 4) pts.push([lr.left + lr.width / 2, lr.top + lr.height / 2]);
    let pass = false, by = null, scroll = false;
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x > vw - 1 || y > vh - 1 || clipped(el, x, y)) continue; // a probe point scrolled out of a strip is not a tap spot
      const h = document.elementFromPoint(x, y);
      if (okHit(el, h)) { pass = true; break; }
      if (h) { const f = fixedLayer(h); if (f && !f.contains(el)) { scroll = true; continue; } }
      by = by || h;
    }
    if (pass || (!by && scroll)) continue;
    if (!by) continue;
    const text = (el.getAttribute("aria-label") || el.textContent || el.value || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    out.push({ key: pathOf(el) + "|" + text, sel: pathOf(el), text, by: pathOf(by) });
  }
  return out;
}
module.exports = { tapAudit };
