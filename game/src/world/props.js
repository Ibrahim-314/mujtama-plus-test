/* Building blocks for interiors: placing a furniture model at a real-world size, neon strips, glowing screens. */
import { Group, Box3, Vector3, Mesh, BoxGeometry, MeshBasicMaterial, Color, CanvasTexture, SRGBColorSpace } from "three";
import { get } from "../engine/assets.js";
import { ASSET } from "../config.js";

export const modelUrl = (name) => ASSET(`models/${name}.glb`);

/**
 * Place a model so its footprint is centred on (x, z), sitting on y, turned by rot, scaled so its largest horizontal
 * side is `size` metres (or its height is `height`). Returns the wrapper group; `.box` is its world collider.
 * @param {string} name @param {{x:number,z:number,y?:number,rot?:number,size?:number,height?:number,solid?:boolean,tint?:number}} o
 */
export async function place(name, o) {
  const { scene } = await get(modelUrl(name));
  const inner = scene, wrap = new Group();
  let b = new Box3().setFromObject(inner); const s = b.getSize(new Vector3());
  const k = o.height ? o.height / (s.y || 1) : (o.size || 1) / (Math.max(s.x, s.z) || 1);
  inner.scale.multiplyScalar(k);
  b = new Box3().setFromObject(inner); const c = b.getCenter(new Vector3());
  inner.position.x -= c.x; inner.position.z -= c.z; inner.position.y -= b.min.y;
  inner.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; if (o.tint != null && m.material) { m.material = m.material.clone(); m.material.color.multiply(new Color(o.tint)); } } });
  wrap.add(inner); wrap.rotation.y = o.rot || 0; wrap.position.set(o.x, o.y || 0, o.z);
  wrap.updateMatrixWorld(true); wrap.box = new Box3().setFromObject(wrap); wrap.solid = o.solid !== false;
  return wrap;
}

/** A glowing strip from a to b (thin box), colour pushed above 1 so it blooms. */
export function strip(a, b, color, k = 3, t = 0.035) {
  const d = new Vector3().subVectors(b, a), len = d.length();
  const m = new Mesh(new BoxGeometry(len, t, t), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(k) }));
  m.position.copy(a).addScaledVector(d, 0.5); m.rotation.y = -Math.atan2(d.z, d.x); m.rotation.z = Math.atan2(d.y, Math.hypot(d.x, d.z));
  return m;
}

/** A canvas-backed screen texture redrawn by draw(ctx, w, h, t) whenever tick() is called. */
export function liveScreen(w, h, draw) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d");
  const tex = new CanvasTexture(cv); tex.colorSpace = SRGBColorSpace;
  return { tex, tick(t) { draw(x, w, h, t); tex.needsUpdate = true; } };
}
