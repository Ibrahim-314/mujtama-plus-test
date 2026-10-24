/* The player on Babylon: the same rigged Quaternius character (Idle / Walking_A / Running_A / Interact) and the same
 * controller as world/player.js — camera-relative joystick and keys, walk-to a tapped point, circle-vs-box collisions,
 * smooth turning, footsteps, a guide ring under the feet and a gold marker where you tapped. pos is a Vector3, so the
 * game's tests keep moving the player with player.pos.set(x, 0, z). Also used for the people on the pavements (npc). */
import { Vector3, Color3 } from "@babylonjs/core/Maths/math.js";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { MOVE, PALETTE } from "../config.js";

const hex = (n) => "#" + n.toString(16).padStart(6, "0");

/** Instance a loaded character container: { root, groups:{name:AnimationGroup}, meshes } scaled to `height` metres. */
export function spawnCharacter(ct, height = 1.72, name = "hero") {
  const e = ct.instantiateModelsToScene((n) => name + ":" + n, false, { doNotInstantiate: true });
  const root = e.rootNodes[0];
  root.rotationQuaternion = null;
  const meshes = root.getChildMeshes(false);
  for (const m of meshes) { m.alwaysSelectAsActiveMesh = true; }
  root.computeWorldMatrix(true);
  let lo = Infinity, hi = -Infinity;
  for (const m of meshes) { m.computeWorldMatrix(true); m.refreshBoundingInfo?.({ applySkeleton: true }); const b = m.getBoundingInfo().boundingBox; lo = Math.min(lo, b.minimumWorld.y); hi = Math.max(hi, b.maximumWorld.y); }
  const h = hi - lo || 1, s = height / h; root.scaling.scaleInPlace(s);
  const groups = {};
  for (const g of e.animationGroups) { g.stop(); groups[g.name.split(":").pop()] = g; }
  return { root, groups, meshes };
}

export class Hero {
  constructor(scene, ch, audio, opts = {}) {
    this.scene = scene; this.ch = ch; this.audio = audio; this.npc = !!opts.npc;
    this.body = ch.root; this.pos = new Vector3(0, 0, 0); this.heading = 0; this.speed = 0; this.target = null; this.locked = false;
    this.cur = null; this.stepT = 0; this.onArrive = null;
    const g = ch.groups;
    this.walkA = g.Walking_A || g.Walk || g.Walking_B || Object.values(g)[0];
    this.runA = g.Running_A || g.Run || this.walkA;
    this.idleA = g.Idle || g.Idle_A || this.walkA;
    this.play("idle");
    if (!this.npc) {
      const mk = (r1, hx, k, a) => {
        const d = CreateDisc("ring", { radius: r1, tessellation: 48 }, scene);
        const m = new StandardMaterial("ringM", scene); m.emissiveColor = Color3.FromHexString(hx).scale(k); m.disableLighting = true; m.alpha = a;
        m.alphaMode = Constants.ALPHA_ADD; m.disableDepthWrite = true; d.material = m; d.rotation.x = Math.PI / 2; d.isPickable = false;
        return d;
      };
      this.ring = mk(0.42, hex(PALETTE.cyan), 1.2, 0.35);
      this.marker = mk(0.26, hex(PALETTE.gold), 1.6, 0);
    }
  }
  play(name, fade = 0.25) {
    const a = name === "walk" ? this.walkA : name === "run" ? this.runA : name === "idle" ? this.idleA : this.ch.groups[name];
    if (!a || a === this.cur) return a;
    const prev = this.cur; this.cur = a;
    a.start(true, 1, a.from, a.to, false); a.setWeightForAllAnimatables(prev ? 0 : 1);
    this._blend = { a, prev, k: prev ? 0 : 1, dur: fade };
    return a;
  }
  /** A one-shot gesture (Interact, Cheer), then back to idle. */
  gesture(name) {
    const a = this.ch.groups[name]; if (!a) return Promise.resolve();
    this.locked = true; const prev = this.cur; this.cur = a; a.start(false, 1, a.from, a.to, false); a.setWeightForAllAnimatables(0); this._blend = { a, prev, k: 0, dur: 0.2 };
    return new Promise((res) => { a.onAnimationGroupEndObservable.addOnce(() => { this.locked = false; this.cur = null; this.play("idle", 0.3); res(); }); });
  }
  walkTo(p) {
    this.target = p ? new Vector3(p.x, 0, p.z) : null;
    if (this.marker) { if (p) { this.marker.position.set(p.x, 0.03, p.z); this.marker.material.alpha = 1; this.marker.scaling.setAll(1.6); } else this.marker.material.alpha = 0; }
  }
  face(x, z) { this.heading = Math.atan2(x - this.pos.x, z - this.pos.z); }
  update(dt, input, camYaw, world) {
    let mx = 0, mz = 0, run = input.run;
    if (!this.locked) {
      if (Math.abs(input.x) + Math.abs(input.y) > 0.08) {
        this.target = null; if (this.marker) this.marker.material.alpha = 0;
        const s = Math.sin(camYaw), c = Math.cos(camYaw);
        mx = input.x * c - input.y * s; mz = -input.x * s - input.y * c;
        const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m; }
      } else if (this.target) {
        const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.12) { this.target = null; if (this.marker) this.marker.material.alpha = 0; this.onArrive?.(); }
        else { mx = dx / d; mz = dz / d; run = !this.npc && d > 3.5; if (d < 0.6) { mx *= d / 0.6 + 0.2; mz *= d / 0.6 + 0.2; } }
      }
    }
    const mag = Math.hypot(mx, mz), want = mag * (this.npc ? (this.pace || 1.15) : run ? MOVE.run : MOVE.walk);
    this.speed += (want - this.speed) * Math.min(1, dt * 10);
    if (mag > 0.01) {
      const h = Math.atan2(mx, mz); let d = h - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * MOVE.turn);
      const bx = this.pos.x, bz = this.pos.z;
      this.pos.x += (mx / mag) * this.speed * dt; if (world) this.collide(world);
      this.pos.z += (mz / mag) * this.speed * dt; if (world) this.collide(world);
      if (this.target && Math.hypot(this.pos.x - bx, this.pos.z - bz) < this.speed * dt * 0.15) { this._stuck = (this._stuck || 0) + dt; if (this._stuck > 0.35) { this._stuck = 0; this.target = null; if (this.marker) this.marker.material.alpha = 0; this.onArrive?.(); } } else this._stuck = 0;
    }
    this.body.position.set(this.pos.x, this.pos.y || 0, this.pos.z);
    this.body.rotation.y = this.heading;
    if (!this.locked) {
      if (this.speed > 0.15) {
        const fast = !this.npc && this.speed > (MOVE.walk + MOVE.run) / 2 && this.runA !== this.walkA;
        const a = this.play(fast ? "run" : "walk");
        if (a) a.speedRatio = fast ? Math.max(0.7, this.speed / MOVE.run) : Math.max(0.6, this.speed / (this.npc ? 1.25 : MOVE.walk)) * 1.05;
      } else this.play("idle");
    }
    const b = this._blend;
    if (b && b.k < 1) { b.k = Math.min(1, b.k + dt / b.dur); b.a.setWeightForAllAnimatables(b.k); if (b.prev && b.prev !== b.a) { b.prev.setWeightForAllAnimatables(1 - b.k); if (b.k >= 1) b.prev.stop(); } }
    if (this.npc) return;
    if (this.speed > 0.3) { this.stepT -= dt * (this.speed / MOVE.walk); if (this.stepT <= 0) { this.stepT = 0.48; this.audio?.sfx("step", { v: Math.min(1, this.speed / MOVE.walk) }); } } else this.stepT = 0.05;
    this.ring.position.set(this.pos.x, 0.025, this.pos.z);
    // the guide ring only shows while you're walking to a tapped spot; standing or steering, nothing sits under the feet
    const ra = this.target ? 0.22 + Math.sin(performance.now() / 400) * 0.06 : 0;
    this.ring.material.alpha += (ra - this.ring.material.alpha) * Math.min(1, dt * 6);
    if (this.marker.material.alpha > 0) { const s = this.marker.scaling.x * (1 - dt * 2.4); this.marker.scaling.setAll(s < 0.6 ? 1.6 : s); }
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
          const px = Math.min(this.pos.x - c.min.x, c.max.x - this.pos.x), pz = Math.min(this.pos.z - c.min.z, c.max.z - this.pos.z);
          if (px < pz) this.pos.x = this.pos.x - c.min.x < c.max.x - this.pos.x ? c.min.x - r : c.max.x + r; else this.pos.z = this.pos.z - c.min.z < c.max.z - this.pos.z ? c.min.z - r : c.max.z + r;
        }
      }
    }
  }
}
