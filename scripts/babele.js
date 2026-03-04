import { MODULE_ID } from "./framework/paths.js";

/**
 * Register Babele translation files shipped with this module.
 * We keep this isolated so MRQOL still works fine without Babele installed.
 */
export function registerBabeleTranslations() {
  const isActive = game.modules.get("babele")?.active;

  if (!isActive) return;

  // Babele v2+ usually exposes a global Babele singleton, but some installs expose game.babele.
  const api = (typeof Babele !== "undefined" && Babele?.get) ? Babele.get() : game?.babele;

  if (!api?.register) {
    console.warn("MRQOL | Babele active but no register API found (Babele version mismatch?)");
    return;
  }

  api.register({
    module: MODULE_ID,
    lang: "es",
    dir: "babele"
  });

  console.log("MRQOL | Babele translations registered (es)");
}