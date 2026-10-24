/* The player's character: a rigged Quaternius model (CC0) with Idle / Walking_A / Interact / Cheer, a movement
 * controller (camera-relative joystick or keys, or walk-to a tapped point), circle-vs-box collisions against the
 * scene's colliders, smooth turning, footstep sounds, and a soft glowing ring under the feet. */
import { AnimationMixer, LoopOnce, Vector3, Mesh, RingGeometry, MeshBasicMaterial, AdditiveBlending, Color, Box3, CircleGeometry } from "three";
import { get } from "../engine/assets.js";
import { ASSET, MOVE, PALETTE } from "../config.js";

export const charUrl = (id) => ASSET(`chars/${id}.glb`);

/** Load a character model, scaled to `height` metres, with its animation actions. */
export async function loadCharacter(id, height = 1.75) {
  const { scene, animations } = await get(charUrl(id));
  scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; if (o.material) { o.material.envMapIntensity = 0.6; } } });
  const b = new Box3().setFromObject(scene); const h = b.max.y - b.min.y || 1; scene.scale.setScalar(height / h);
  const b2 = new Box3().setFromObject(scene); scene.position.y -= b2.min.y;
  const mixer = new AnimationMixer(scene), acts = {};
  for (const clip of animations) acts[clip.name] = mixer.clipAction(clip);
  const walk = acts.Walking_A || acts.Walk || Object.values(acts)[0];
  return { model: scene, mixer, acts, walk, idle: acts.Idle || walk };
}

export class Player {
  /** @param {any} ch loadCharacter() result */
  constructor(ch, audio) {
    this.ch = ch; this.audio = audio; this.root = ch.model.parent ? ch.model : ch.model;
    this.obj = ch.model; this.pos = this.obj.position; this.heading = 0; this.speed = 0; this.target = null; this.locked = false;
    this.cur = null; this.play("idle"); this.stepT = 0;
    // the guide ring under the feet
    this.ring = new Mesh(new RingGeometry(0.34, 0.42, 48), new MeshBasicMaterial({ color: new Color(PALETTE.cyan).multiplyScalar(2.2), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.012;
    this.shadow = new Mesh(new CircleGeometry(0.42, 32), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.008;
    this.marker = new Mesh(new RingGeometry(0.18, 0.26, 32), new MeshBasicMaterial({ color: new Color(PALETTE.gold).multiplyScalar(2.5), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.position.y = 0.015;
  }
  addTo(scene) { scene.add(this.obj, this.ring, this.shadow, this.marker); }
  play(name, fade = 0.25) {
    const a = name === "walk" ? this.ch.walk : name === "idle" ? this.ch.idle : this.ch.acts[name];
    if (!a || a === this.cur) return a;
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    if (this.cur) a.crossFadeFrom(this.cur, fade, false);
    a.play(); this.cur = a; return a;
  }
  /** Play a one-shot (Interact, Cheer) and come back to idle. */
  gesture(name) {
    const a = this.ch.acts[name]; if (!a) return Promise.resolve();
    a.setLoop(LoopOnce, 1); a.clampWhenFinished = true; this.locked = true; this.play(name, 0.2);
    return new Promise((res) => { const done = (e) => { if (e.action !== a) return; this.ch.mixer.removeEventListener("finished", done); this.locked = false; this.cur = null; this.play("idle", 0.3); res(); }; this.ch.mixer.addEventListener("finished", done); });
  }
  walkTo(p) { this.target = p ? new Vector3(p.x, 0, p.z) : null; if (p) { this.marker.position.set(p.x, 0.015, p.z); this.marker.material.opacity = 1; this.marker.scale.setScalar(1.6); } }
  face(x, z) { this.heading = Math.atan2(x - this.pos.x, z - this.pos.z); }
  /**
   * @param {number} dt @param {{x:number,y:number,run:boolean}} input @param {number} camYaw camera yaw (for camera-relative moves)
   * @param {{ colliders: Box3[], bounds: {minX,maxX,minZ,maxZ} }} world
   */
  update(dt, input, camYaw, world) {
    let mx = 0, mz = 0, run = input.run;
    if (!this.locked) {
      if (Math.abs(input.x) + Math.abs(input.y) > 0.08) {
        this.target = null; this.marker.material.opacity = 0;
        const s = Math.sin(camYaw), c = Math.cos(camYaw);
        mx = input.x * c - input.y * s; mz = -input.x * s - input.y * c;
        // camera-relative: forward (y+) moves away from the camera
        const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m; }
      } else if (this.target) {
        const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.12) { this.target = null; this.marker.material.opacity = 0; this.onArrive?.(); }
        else { mx = dx / d; mz = dz / d; run = d > 3.5; if (d < 0.6) { mx *= d / 0.6 + 0.2; mz *= d / 0.6 + 0.2; } }
      }
    }
    const mag = Math.hypot(mx, mz), want = mag * (run ? MOVE.run : MOVE.walk);
    this.speed += (want - this.speed) * Math.min(1, dt * 10);
    if (mag > 0.01) {
      const h = Math.atan2(mx, mz); let d = h - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * MOVE.turn);
      const nx = this.pos.x + (mx / mag) * this.speed * dt, nz = this.pos.z + (mz / mag) * this.speed * dt;
      const before = { x: this.pos.x, z: this.pos.z };
      this.pos.x = nx; this.collide(world); this.pos.z = nz; this.collide(world);
      if (this.target && Math.hypot(this.pos.x - before.x, this.pos.z - before.z) < this.speed * dt * 0.15) { this._stuck = (this._stuck || 0) + dt; if (this._stuck > 0.35) { this._stuck = 0; this.target = null; this.marker.material.opacity = 0; this.onArrive?.(); } } else this._stuck = 0;
    }
    this.obj.rotation.y = this.heading;
    if (!this.locked) {
      if (this.speed > 0.15) { const a = this.play("walk"); if (a) a.timeScale = Math.max(0.6, this.speed / MOVE.walk) * 1.05; }
      else this.play("idle");
    }
    this.ch.mixer.update(dt);
    // footsteps
    if (this.speed > 0.3) { this.stepT -= dt * (this.speed / MOVE.walk); if (this.stepT <= 0) { this.stepT = 0.48; this.audio?.sfx("step", { v: Math.min(1, this.speed / MOVE.walk) }); } } else this.stepT = 0.05;
    this.ring.position.x = this.shadow.position.x = this.pos.x; this.ring.position.z = this.shadow.position.z = this.pos.z;
    this.ring.material.opacity = 0.35 + Math.sin(performance.now() / 400) * 0.15;
    if (this.marker.material.opacity > 0) { this.marker.scale.multiplyScalar(1 - dt * 2.4); if (this.marker.scale.x < 0.6) this.marker.scale.setScalar(1.6); }
  }
  collide(world) {
    const r = MOVE.radius, b = world.bounds;
    this.pos.x = Math.min(b.maxX - r, Math.max(b.minX + r, this.pos.x)); this.pos.z = Math.min(b.maxZ - r, Math.max(b.minZ + r, this.pos.z));
    for (const c of world.colliders) {
      const cx = Math.max(c.min.x, Math.min(this.pos.x, c.max.x)), cz = Math.max(c.min.z, Math.min(this.pos.z, c.max.z));
      const dx = this.pos.x - cx, dz = this.pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; this.pos.x += dx * k; this.pos.z += dz * k; }
        else { // centre inside the box: push out on the shortest axis
          const px = Math.min(this.pos.x - c.min.x, c.max.x - this.pos.x), pz = Math.min(this.pos.z - c.min.z, c.max.z - this.pos.z);
          if (px < pz) this.pos.x = this.pos.x - c.min.x < c.max.x - this.pos.x ? c.min.x - r : c.max.x + r; else this.pos.z = this.pos.z - c.min.z < c.max.z - this.pos.z ? c.min.z - r : c.max.z + r;
        }
      }
    }
  }
}
