import { MODULE_ID } from "../../../framework/paths.js";
import { MRQOLCharacterCreatorApp } from "./app.js";

let __mrqolCharacterCreatorApp = null;

/**
 * Open (or focus) the Character Creator wizard.
 */
export async function openCharacterCreator() {
  if (!__mrqolCharacterCreatorApp) {
    __mrqolCharacterCreatorApp = new MRQOLCharacterCreatorApp();
  }

  // Render is async in ApplicationV2; wait for DOM before trying to focus.
  await __mrqolCharacterCreatorApp.render({ force: true });

  // bringToFront can fail if element isn't mounted yet; be defensive.
  try {
    __mrqolCharacterCreatorApp.bringToFront?.();
  } catch (_err) {
    // No-op: render already opened the window.
  }
}

/**
 * Register the Actors Directory header button.
 *
 * IMPORTANT: Call this exactly once (CorePack.init is the right place).
 */
export function registerCharacterCreator() {
  const canShow = () => {
  // GM always
  if (game.user?.isGM) return true;

  // Prefer permission check if available
  try {
    if (typeof game.user?.can === "function") return game.user.can("ACTOR_CREATE");
  } catch (_err) {
    // fall through
  }

  // Fallback: approximate by role (Assistant+ usually can create things if granted)
  try {
    return (game.user?.role ?? 0) >= (CONST?.USER_ROLES?.ASSISTANT ?? 2);
  } catch (_err) {
    return false;
  }
};

  const addV2HeaderControl = (controls) => {
    // Avoid duplicates
    if (controls.some((c) => c?.action === "mrqol-character-creator")) return;

    controls.unshift({
      icon: "fa-solid fa-wand-magic-sparkles",
      label: game.i18n.localize("MRQOL.CharacterCreator.Button"),
      action: "mrqol-character-creator",
      onClick: () => openCharacterCreator()
    });
  };

  // Preferred: ApplicationV2 header controls (when available)
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    if (!canShow()) return;

    // Be tolerant: Actor directory naming can vary
    const name = app?.constructor?.name ?? "";
    const isActorsDirectory =
      name === "ActorDirectory" ||
      name === "ActorsDirectory" ||
      name === "ActorsSidebarTab" ||
      (typeof name === "string" && name.toLowerCase().includes("actor"));

    if (!isActorsDirectory) return;

    addV2HeaderControl(controls);
  });

  // Fallback: inject a button into the Actor Directory header on render
  Hooks.on("renderActorDirectory", (app, html) => {
    if (!canShow()) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    // Avoid duplicates
    if (root.querySelector(".mrqol-character-creator-btn")) return;

    const header =
      root.querySelector(".directory-header") ||
      root.querySelector("header.directory-header") ||
      root.querySelector("header");

    if (!header) return;

    const actions =
      header.querySelector(".header-actions") ||
      header.querySelector(".action-buttons") ||
      header.querySelector(".header-actions.action-buttons") ||
      header;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("mrqol-character-creator-btn");
    btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> ${game.i18n.localize("MRQOL.CharacterCreator.Button")}`;
    btn.addEventListener("click", () => openCharacterCreator());

    actions.appendChild(btn);
  });
}