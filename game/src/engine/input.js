/* Input: keyboard (WASD / arrows, Shift to run, E / Enter / Space to act, Esc for the menu), a virtual joystick on touch
 * screens (left thumb, appears where the thumb lands), and taps on the world (tap-to-walk, tap-to-use).
 * Output: input.move = {x, y, run} each frame (y forward), events "action", "pause", "tap" {x, y} in normalized coords. */
import { Bus } from "./bus.js";

export class Input extends Bus {
  /** @param {HTMLElement} surface the element that receives pointer input (the canvas wrapper) @param {HTMLElement} ui */
  constructor(surface, ui) {
    super();
    this.surface = surface; this.ui = ui; this.keys = new Set(); this.enabled = true;
    this.move = { x: 0, y: 0, run: false }; this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.touch = matchMedia("(pointer: coarse)").matches;
    this.kd = (e) => this.key(e, true); this.ku = (e) => this.key(e, false);
    addEventListener("keydown", this.kd); addEventListener("keyup", this.ku);
    this.blur = () => this.keys.clear(); addEventListener("blur", this.blur);
    // the joystick: a base + knob, shown under the thumb on the left half of the screen
    this.joy = document.createElement("div"); this.joy.className = "gm-joy"; this.joy.setAttribute("aria-hidden", "true");
    this.joy.innerHTML = '<i class="gm-joy-knob"></i>'; ui.append(this.joy);
    this.pd = (e) => this.down(e); this.pm = (e) => this.mv(e); this.pu = (e) => this.up(e);
    surface.addEventListener("pointerdown", this.pd); addEventListener("pointermove", this.pm, { passive: true });
    addEventListener("pointerup", this.pu); addEventListener("pointercancel", this.pu);
    this.taps = new Map();
  }
  key(e, on) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (on && !e.repeat) {
      if (k === "e" || k === "enter" || k === " ") { if (this.enabled) this.emit("action"); }
      if (k === "escape") this.emit("pause");
    }
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) { if (on) this.keys.add(k); else this.keys.delete(k); if (this.enabled && k.startsWith("arrow")) e.preventDefault(); }
  }
  down(e) {
    if (!this.enabled) return;
    const r = this.surface.getBoundingClientRect();
    const lx = e.clientX - r.left, ly = e.clientY - r.top;
    // the left 45% bottom 65% of a touch screen is the joystick zone
    if (e.pointerType !== "mouse" && this.stick.id == null && lx < r.width * 0.45 && ly > r.height * 0.35) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      this.joy.style.setProperty("--jx", e.clientX - r.left + "px"); this.joy.style.setProperty("--jy", e.clientY - r.top + "px");
      this.joy.classList.add("on"); this.setKnob(0, 0); return;
    }
    this.taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  }
  mv(e) {
    if (e.pointerId !== this.stick.id) return;
    const R = 46; let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy; const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    this.stick.x = dx / R; this.stick.y = -dy / R; this.setKnob(dx, dy);
  }
  up(e) {
    if (e.pointerId === this.stick.id) { this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 }; this.joy.classList.remove("on"); return; }
    const t = this.taps.get(e.pointerId); this.taps.delete(e.pointerId);
    if (!t || !this.enabled) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12 && performance.now() - t.t < 450) {
      const r = this.surface.getBoundingClientRect();
      this.emit("tap", { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 });
    }
  }
  setKnob(x, y) { this.joy.style.setProperty("--kx", x + "px"); this.joy.style.setProperty("--ky", y + "px"); }
  /** Call once per frame. */
  update() {
    const k = this.keys; let x = 0, y = 0;
    if (k.has("a") || k.has("arrowleft")) x -= 1; if (k.has("d") || k.has("arrowright")) x += 1;
    if (k.has("w") || k.has("arrowup")) y += 1; if (k.has("s") || k.has("arrowdown")) y -= 1;
    let run = k.has("shift");
    if (this.stick.id != null) { x = this.stick.x; y = this.stick.y; run = Math.hypot(x, y) > 0.92; }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    if (!this.enabled) { x = 0; y = 0; }
    this.move.x = x; this.move.y = y; this.move.run = run;
    return this.move;
  }
  setEnabled(on) { this.enabled = on; if (!on) { this.keys.clear(); this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 }; this.joy.classList.remove("on"); } }
  dispose() {
    removeEventListener("keydown", this.kd); removeEventListener("keyup", this.ku); removeEventListener("blur", this.blur);
    this.surface.removeEventListener("pointerdown", this.pd); removeEventListener("pointermove", this.pm);
    removeEventListener("pointerup", this.pu); removeEventListener("pointercancel", this.pu); this.joy.remove(); this.clear();
  }
}
