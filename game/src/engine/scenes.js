/* The scene manager. A scene is a module that exports `create(game, params)` and returns
 *   { scene, camera, update(dt, t), dispose(), enter?(), exit?(), bloom? }
 * go(name) fades to black, disposes the old scene (geometry, materials, textures), builds the new one behind the fade,
 * hands it to the renderer and fades back in. Scenes register themselves in scenes/index.js — adding a place to the
 * game is adding one file there. */
export class Scenes {
  constructor(game, registry) { this.game = game; this.reg = registry; this.cur = null; this.name = null; this.busy = false; }
  async go(name, params = {}) {
    if (this.busy) return; this.busy = true;
    const g = this.game, ui = g.ui;
    try {
      if (this.cur) { await ui.fade(true, params.fade ?? 450); this.cur.exit?.(); this.free(this.cur); this.cur = null; }
      const make = this.reg[name]; if (!make) throw new Error("scene " + name);
      ui.clearScene();
      const s = await (await make()).create(g, params);
      this.cur = s; this.name = name;
      g.renderer.setBloom(s.bloom || { strength: 0.85, radius: 0.55, threshold: 0.78 });
      g.renderer.setScene(s.scene, s.camera);
      s.enter?.();
      await ui.fade(false, params.fadeIn ?? 650);
    } finally { this.busy = false; }
  }
  update(dt, t) { this.cur?.update?.(dt, t); }
  free(s) {
    try { s.dispose?.(); } catch (e) { console.error(e); }
    s.scene?.traverse((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose?.(); }
    });
  }
  dispose() { if (this.cur) this.free(this.cur); this.cur = null; }
}
