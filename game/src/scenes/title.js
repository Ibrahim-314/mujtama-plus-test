/* The title screen: a slow cinematic flight around the MJT Core through the night city in the rain.
 * First tap: «المس للبدء» wakes the sound and enters full screen (browsers allow both only after a tap), then the menu
 * rises: continue (with the saved name) or a new game, settings, exit. */
import { Scene, PerspectiveCamera, Fog, Vector3 } from "three";
import { buildSkyline } from "../world/skyline.js";
import { PALETTE, charById } from "../config.js";
import { t, tl } from "../engine/i18n.js";
import { esc, icon } from "../ui/ui.js";
import { openSettings } from "../ui/menus.js";

export async function create(game) {
  const scene = new Scene(); scene.fog = new Fog(PALETTE.fog, 120, 700);
  const camera = new PerspectiveCamera(50, 1, 0.5, 2000);
  const city = buildSkyline({ quality: game.renderer.q, rain: true, radius: 170, seed: 11 });
  scene.add(city.group);
  const look = new Vector3(0, 52, 0);
  let a = 0.6, started = !!game.audio.ctx;

  const save = game.save.data, has = game.save.exists;
  const L = game.ui.layer(`
    <div class="gm-title">
      <div class="gm-logo">
        <span class="gm-logo-k">${esc(t("مجتمع كوين", "MUJTAMA COIN"))} · MJT</span>
        <h1 class="gm-logo-t" data-text="${esc(t("المدينة الرقمية", "The Digital City"))}">${esc(t("المدينة الرقمية", "The Digital City"))}</h1>
        <span class="gm-logo-s">${esc(t("ابنِ ثروتك في مدينة لا تنام", "Build your fortune in a city that never sleeps"))}</span>
      </div>
      <button type="button" class="gm-press" id="gm-press">${esc(t("المس للبدء", "Tap to start"))}</button>
      <nav class="gm-menu gm-title-menu" id="gm-tmenu" hidden>
        ${has ? `<button type="button" class="gm-btn wide hero" data-a="continue" data-sfx="confirm">${icon("play")}<span>${esc(t("متابعة", "Continue"))}<small>${esc(save.name)} · ${esc(tl({ ar: charById(save.char).ar, en: charById(save.char).en }))}</small></span></button>` : ""}
        <button type="button" class="gm-btn wide ${has ? "ghost" : "hero"}" data-a="new" data-sfx="confirm">${icon("star")}<span>${esc(has ? t("لعبة جديدة", "New game") : t("ابدأ اللعبة", "Start the game"))}</span></button>
        <button type="button" class="gm-btn ghost wide" data-a="settings">${icon("gear")}<span>${esc(t("الإعدادات", "Settings"))}</span></button>
        <button type="button" class="gm-btn ghost wide" data-a="exit" data-sfx="back">${icon("exit")}<span>${esc(t("الخروج", "Exit"))}</span></button>
      </nav>
      <span class="gm-ver">v${game.version} · ${esc(t("الفصل 0", "Chapter 0"))}</span>
    </div>`, "gm-title-l");

  const menu = L.querySelector("#gm-tmenu"), press = L.querySelector("#gm-press");
  const reveal = () => { press.hidden = true; menu.hidden = false; requestAnimationFrame(() => menu.classList.add("on")); L.querySelector(".gm-title").classList.add("live"); menu.querySelector("button")?.focus({ preventScroll: true }); };
  press.addEventListener("click", () => { game.audio.unlock(); game.audio.music("title"); game.audio.ambient("city"); game.audio.sfx("reveal"); game.enterFullscreen(); started = true; reveal(); });
  if (started) reveal();
  menu.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-a]")?.dataset.a; if (!act) return;
    if (act === "continue") game.scenes.go(save.scene || "room");
    if (act === "new") {
      if (has) {
        const p = game.ui.modal(`<header class="gm-ph">${icon("star")}<h2>${esc(t("لعبة جديدة؟", "New game?"))}</h2></header>
          <p class="gm-note">${esc(t("ستختار شخصية واسماً من جديد وتبدأ القصة من أولها. رصيدك من مجتمع كوين والتعدين لا يتأثر.", "You will pick a character and name again and the story starts over. Your Mujtama Coin balance and mining are not affected."))}</p>
          <footer class="gm-pf two"><button type="button" class="gm-btn ghost" data-a="no" data-sfx="back">${esc(t("إلغاء", "Cancel"))}</button><button type="button" class="gm-btn" data-a="yes" data-sfx="confirm">${esc(t("ابدأ من جديد", "Start over"))}</button></footer>`);
        p.addEventListener("click", (ev) => { const b = ev.target.closest("[data-a]")?.dataset.a; if (!b) return; game.ui.closeModal(); if (b === "yes") game.scenes.go("creator", { fresh: true }); });
        return;
      }
      game.scenes.go("creator");
    }
    if (act === "settings") openSettings(game);
    if (act === "exit") game.exit();
  });

  return {
    scene, camera, bloom: { strength: 1.05, radius: 0.6, threshold: 0.72 },
    enter() { if (game.audio.ctx) { game.audio.music("title"); game.audio.ambient("city"); } },
    update(dt, time) {
      a += dt * 0.045;
      const r = 118 + Math.sin(time * 0.07) * 14, h = 34 + Math.sin(time * 0.05) * 10;
      camera.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
      camera.lookAt(look.x + Math.sin(time * 0.2) * 2, look.y + Math.sin(time * 0.13) * 3, look.z);
      city.update(dt, time);
    },
    dispose() { }
  };
}
