import { MODULE_ID } from "./framework/paths.js";

export function registerSettings() {
  // Master toggles
  game.settings.register(MODULE_ID, "packs.core.enabled", {
    name: "Core Pack",
    hint: "Enable Core QOL features.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
	requiresReload: true
  });

  game.settings.register(MODULE_ID, "packs.automation.enabled", {
    name: "Automation Pack",
    hint: "Enable experimental automation features.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
	requiresReload: true
  });

  game.settings.register(MODULE_ID, "packs.integrations.enabled", {
    name: "Integrations Pack",
    hint: "Enable optional integrations.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
	requiresReload: true
  });

  /* -------------------------------------------- */
  /* Automation: Damage application                */
  /* -------------------------------------------- */

  game.settings.register(MODULE_ID, "automation.damage.enabled", {
    name: "Automation: Apply weapon damage",
    hint: "Adds an 'Apply Damage' button to damage chat cards and can auto-apply damage to a single targeted token.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.damage.autoApply", {
    name: "Automation: Auto-apply when 1 target",
    hint: "When exactly one token is targeted, automatically apply damage as soon as a damage card is posted.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.damage.showButton", {
    name: "Automation: Show 'Apply Damage' button",
    hint: "Adds an 'Apply Damage' button on damage chat cards.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

/* -------------------------------------------- */
/* Automation: STR 0 rule                        */
/* -------------------------------------------- */

game.settings.register(MODULE_ID, "automation.strZero.houseRule.enabled", {
  name: "Automation: House rule for STR 0 (instead of Dead)",
  hint: "If enabled: when STR reaches 0, targets become Unconscious and gain the Injured condition instead of dying (RAW).",
  scope: "world",
  config: true,
  type: Boolean,
  default: false
});

game.settings.register(MODULE_ID, "automation.strZero.houseRule.scope", {
  name: "Automation: House rule applies to",
  hint: "Choose which actor types are affected by the STR 0 house rule.",
  scope: "world",
  config: true,
  type: String,
  choices: {
    characters: "Only Mice (character)",
    charactersHirelings: "Mice + Hirelings (character + hireling)",
    allCreatures: "All creatures (character + hireling + creature)"
  },
  default: "characters"
});

  // Repairs
  game.settings.register(MODULE_ID, "core.repairs.enabled", {
    name: "Repairs: Enable",
    hint: "Adds repair buttons and applies Mausritter repair rules.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Inventory layout / rules
  game.settings.register(MODULE_ID, "core.inventoryLayout.enabled", {
    name: "Inventory Layout: Enable",
    hint: "Tracks inventory placement (Carried/Worn/Pack/Grit/Bank) and applies rules.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  

  // Optional utility
  game.settings.register(MODULE_ID, "core.inventoryLayout.reorderButton", {
    name: "Inventory Layout: Reorder button",
    hint: "Adds a sheet header button to auto-pack items into a valid grid layout (repairs broken placement flags).",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
game.settings.register(MODULE_ID, "core.inventoryLayout.snap", {
    name: "Inventory Layout: Snap",
    hint: "Snap items to the nearest valid slot when dropped.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "core.inventoryLayout.strict", {
    name: "Inventory Layout: Prevent overlap in equipment",
    hint: "Prevents multiple items occupying Carried/Worn/Grit/Bank slots. Pack can overlap.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "core.inventoryLayout.threshold", {
    name: "Inventory Layout: Drop threshold",
    hint: "How much of a slot must overlap the card to consider it placed (0.1–0.9).",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0.1, max: 0.9, step: 0.05 },
    default: 0.35
  });

  // Encumbrance integration
  game.settings.register(MODULE_ID, "core.inventoryLayout.encumbrance.excludeItemPiles", {
    name: "Encumbrance: Exclude Item Piles",
    hint: "Do not apply Encumbered to Item Piles / loot pile actors.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

