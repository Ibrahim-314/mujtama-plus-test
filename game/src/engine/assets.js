/* Asset loading: one GLTF loader, one cache per URL, progress for the loading screen.
 * get(url) gives a fresh copy of the model every time (skinned characters are cloned with their skeleton). */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skClone } from "three/addons/utils/SkeletonUtils.js";

const loader = new GLTFLoader();
const cache = new Map();
let pending = 0, done = 0;
const listeners = new Set();
const report = () => { for (const fn of listeners) fn(pending ? done / (done + pending) : 1); };
export const onProgress = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function load(url) {
  if (!cache.has(url)) {
    pending++; report();
    cache.set(url, new Promise((res, rej) => loader.load(url, (g) => { pending--; done++; report(); res(g); }, undefined, (e) => { pending--; report(); cache.delete(url); rej(e); })));
  }
  return cache.get(url);
}
/** A fresh scene graph for the model at url, plus its animations. */
export async function get(url) {
  const g = await load(url);
  const scene = g.scene.getObjectByProperty("type", "SkinnedMesh") ? skClone(g.scene) : g.scene.clone(true);
  return { scene, animations: g.animations };
}
export const preload = (urls) => Promise.all(urls.map((u) => load(u).catch(() => null)));
