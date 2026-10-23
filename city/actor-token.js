/* مجتمع بلس — «المدينة» character renderer "token" (city/actor-token.js). The interface every character renderer follows:
 *   MPCity.actor(name, (layer, { util, scene, opts }) => ({ update({ x, y, angle, moving, W, H }), destroy() }))
 * The core moves the layer's --x/--y (percent of the stage); a renderer only draws the character standing there.
 * "token" is the member's own emblem — their photo (or initial) on a glowing holo base — and is the light fallback on
 * devices without WebGL once the 3D character ("3d") lands in the character step. */
(function CityActorToken() {
  "use strict";
  const { el, esc } = MPCity.util;
  MPCity.actor("token", (layer) => {
    const me = (typeof S !== "undefined" && S.me && S.me()) || null;
    const src = me && me.avatar ? me.avatar["64"] || me.avatar["200"] || "" : "";
    const a = el("div", "cy-actor cy-token");
    a.innerHTML = `<span class="cy-a-shadow"></span><span class="cy-a-base"><i></i><i></i></span><span class="cy-a-beam"></span>`
      + `<span class="cy-a-body"><span class="cy-a-av">${src ? `<img src="${esc(src)}" alt="" decoding="async">` : `<b>${esc(((me && me.name) || "؟").trim().charAt(0))}</b>`}</span><span class="cy-a-tip"></span></span>`;
    a.style.setProperty("--c", (me && me.color) || "var(--brand-1)");
    layer.append(a);
    let last = null;
    return {
      el: a,
      update(s) {
        if (last === null || last.moving !== s.moving) a.classList.toggle("walk", s.moving);
        // lean slightly toward where it is heading (screen x of the heading), never upside down
        const lean = Math.max(-1, Math.min(1, Math.cos(s.angle))) * 7;
        a.style.setProperty("--lean", (s.moving ? lean : 0).toFixed(1) + "deg");
        last = s;
      },
      enter() { a.classList.add("enter"); },
      exit() { a.classList.remove("enter"); },
      destroy() { a.remove(); }
    };
  });
})();
