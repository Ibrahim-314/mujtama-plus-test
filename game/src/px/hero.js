/* A walker in the pixel world: the same controller as the 3D Hero (bjs/hero.js) — joystick / keys, walk to a tapped
 * point, circle-vs-box collisions against the scene's colliders, turning, footsteps — drawn as a pixel sprite.
 * pos keeps {x, y, z} with set(x, y, z), heading is atan2(dx, dz), so the scenes' story code and the game's tests
 * treat it exactly like the 3D player. Screen up is −z: the joystick's forward walks up the screen. */
import { MOVE } from "../config.js";
import { drawPerson, facing } from "./sprites.js";
import { PPM } from "./core.js";

class P { constructor() { this.x = 0; this.y = 0; this.z = 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }

export class PxHero {
  constructor(look, audio, opts = {}) {
    this.look = look; this.audio = audio; this.npc = !!opts.npc;
    this.pos = new P(); this.heading = Math.PI; this.speed = 0; this.target = null; this.locked = false; this.onArrive = null;
    this.stepT = 0; this.anim = 0; this.gest = null; this.mark = null;
  }
  walkTo(p) { this.target = p ? { x: p.x, z: p.z } : null; this.mark = p ? { x: p.x, z: p.z, k: 1 } : null; }
  face(x, z) { const dx = x - this.pos.x, dz = z - this.pos.z; if (Math.abs(dx) + Math.abs(dz) > 1e-4) this.heading = Math.atan2(dx, dz); }
  /** a one-shot gesture: Interact = a reach, Cheer = a hop; then back to standing */
  gesture(name) {
    this.locked = true; const dur = name === "Cheer" ? 900 : 520;
    return new Promise((res) => { this.gest = { name, t0: performance.now(), dur, res }; });
  }
  update(dt, input, _yaw, world) {
    let mx = 0, mz = 0, run = input.run;
    if (this.gest && performance.now() - this.gest.t0 > this.gest.dur) { const r = this.gest.res; this.gest = null; this.locked = false; r(); }
    if (!this.locked) {
      if (Math.abs(input.x) + Math.abs(input.y) > 0.08) {
        this.target = null; this.mark = null; mx = input.x; mz = -input.y;
        const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m; }
      } else if (this.target) {
        const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.12) { this.target = null; this.mark = null; this.onArrive?.(); }
        else { mx = dx / d; mz = dz / d; run = !this.npc && d > 3.5; if (d < 0.6) { mx *= d / 0.6 + 0.2; mz *= d / 0.6 + 0.2; } }
      }
    }
    const mag = Math.hypot(mx, mz), want = mag * (this.npc ? (this.pace || 1.15) : run ? MOVE.run : MOVE.walk);
    this.speed += (want - this.speed) * Math.min(1, dt * 10);
    if (mag > 0.01) {
      const h = Math.atan2(mx, mz); let d = h - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * MOVE.turn * 1.5);
      const bx = this.pos.x, bz = this.pos.z;
      this.pos.x += (mx / mag) * this.speed * dt; if (world) this.collide(world);
      this.pos.z += (mz / mag) * this.speed * dt; if (world) this.collide(world);
      if (this.target && Math.hypot(this.pos.x - bx, this.pos.z - bz) < this.speed * dt * 0.15) { this._stuck = (this._stuck || 0) + dt; if (this._stuck > 0.35) { this._stuck = 0; this.target = null; this.mark = null; this.onArrive?.(); } } else this._stuck = 0;
    }
    this.anim = this.speed > 0.15 ? this.anim + dt * this.speed * 3.2 : 0;
    if (this.mark) this.mark.k = Math.max(0, this.mark.k - dt * 1.5);
    if (this.npc) return;
    if (this.speed > 0.3) { this.stepT -= dt * (this.speed / MOVE.walk); if (this.stepT <= 0) { this.stepT = 0.48; this.audio?.sfx("step", { v: Math.min(1, this.speed / MOVE.walk) }); } } else this.stepT = 0.05;
  }
  collide(world) {
    const r = MOVE.radius, b = world.bounds;
    this.pos.x = Math.min(b.maxX - r, Math.max(b.minX + r, this.pos.x)); this.pos.z = Math.min(b.maxZ - r, Math.max(b.minZ + r, this.pos.z));
    for (const c of world.colliders) {
      const cx = Math.max(c.min.x, Math.min(this.pos.x, c.max.x)), cz = Math.max(c.min.z, Math.min(this.pos.z, c.max.z));
      const dx = this.pos.x - cx, dz = this.pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; this.pos.x += dx * k; this.pos.z += dz * k; }
        else {
          const ex = Math.min(this.pos.x - c.min.x, c.max.x - this.pos.x), ez = Math.min(this.pos.z - c.min.z, c.max.z - this.pos.z);
          if (ex < ez) this.pos.x = this.pos.x - c.min.x < c.max.x - this.pos.x ? c.min.x - r : c.max.x + r;
          else this.pos.z = this.pos.z - c.min.z < c.max.z - this.pos.z ? c.min.z - r : c.max.z + r;
        }
      }
    }
  }
  /** draw at its spot (view = px/core makeView). The player gets a cyan ring under the feet and a gold tap marker. */
  draw(v, t) {
    const c = v.ctx, x = v.sx(this.pos.x), y = v.sy(this.pos.z, this.pos.y || 0);
    if (!this.npc && this.mark && this.mark.k > 0) { c.globalAlpha = this.mark.k; c.strokeStyle = "#ffc23d"; c.beginPath(); c.ellipse(v.sx(this.mark.x) + 0.5, v.sy(this.mark.z) + 0.5, 3 + (1 - this.mark.k) * 5, 1.5 + (1 - this.mark.k) * 2.5, 0, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
    if (!this.npc && this.target) { c.globalAlpha = 0.3 + Math.sin(t * 6) * 0.1; c.strokeStyle = "#2fe6ff"; c.beginPath(); c.ellipse(x + 0.5, y + 0.5, 7, 3, 0, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
    const dir = facing(this.heading); let frame = this.speed > 0.15 ? 1 + (Math.floor(this.anim) % 2) : 0, lift = 0;
    if (this.gest) {
      const k = (performance.now() - this.gest.t0) / this.gest.dur;
      if (this.gest.name === "Cheer") { lift = Math.round(Math.abs(Math.sin(k * Math.PI * 2)) * 4); frame = 1; }
      else frame = k < 0.5 ? 1 : 0;
    }
    drawPerson(c, this.look, x, y, dir, frame, { lift });
    void PPM;
  }
}
