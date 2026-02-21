import { registerSettings } from "./settings.js";
import { PackManager } from "./framework/packs.js";

// Helper: dynamic import with error isolation so settings always load
async function safeImport(path) {
  try {
    await import(path);
    console.log(`MRQOL | Loaded pack module: ${path}`);
    return true;
  } catch (err) {
    console.error(`MRQOL | Failed to load pack module: ${path}`, err);
    return false;
  }
}

Hooks.once("init", async () => {
  console.log("MRQOL | init");

  // 1) Settings MUST register even if packs crash
  try {
    registerSettings();
    console.log("MRQOL | settings registered");
  } catch (err) {
    console.error("MRQOL | Failed to register settings", err);
  }

  // 2) Load packs dynamically (isolated)
  //    NOTE: paths are relative to this file.
  await safeImport("./packs/core/index.js");
  await safeImport("./packs/automation/index.js");
  await safeImport("./packs/integrations/index.js");

  // 3) Init pack manager (only uses what successfully registered)
  try {
    PackManager.init();
    console.log("MRQOL | PackManager initialized");
  } catch (err) {
    console.error("MRQOL | PackManager.init failed", err);
  }
});

Hooks.once("ready", () => {
  console.log("MRQOL | ready");
});
