import { MODULE_ID } from "./framework/paths.js";

export function registerSettings() {
  // Client preference: default content language to apply via sheet button
  game.settings.register(MODULE_ID, "i18nSync.preferredLang", {
    name: "Content Language (default)",
    hint: "Default language used by the Actor/Item 'Language' button to sync imported documents.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      world: "World language",
      en: "English",
      es: "Spanish"
    },
    default: "world"
  });

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
/* Automation: Rest UI                           */
/* -------------------------------------------- */

  game.settings.register(MODULE_ID, "automation.rest.enabled", {
    name: "Automation: Rest UI buttons (short/long/full)",
    hint: "Adds rest buttons to actor sheets and applies Mausritter rest & healing rules with a chat log.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

/* -------------------------------------------- */
/* Automation: Wear (usage)                       */
/* -------------------------------------------- */

  game.settings.register(MODULE_ID, "automation.wear.enabled", {
    name: "Automation: Wear after combat / spells",
    hint: "Marks item usage after combat (d6, 4-6) and after spell casts (based on the spell roll).",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.wear.combat.equippedOnly", {
    name: "Automation: Wear (combat) - equipped only",
    hint: "If enabled, only equipped weapons/armour/ammunition are checked for wear at combat end.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.wear.combat.includeAmmo", {
    name: "Automation: Wear (combat) - include ammunition",
    hint: "If enabled, ammunition items (tag: Ammunition) can also gain usage after combat.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.wear.combat.alwaysMarkSilvered", {
    name: "Automation: Wear (combat) - always mark silvered weapons",
    hint: "If enabled, weapons with 'silver' in their name always mark 1 usage after combat (RAW for silvered weapons).",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.wear.spells.enabled", {
    name: "Automation: Wear (spells)",
    hint: "When a spell is cast, mark usage based on dice results (4-6) without re-rolling.",
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
    name: game.i18n.localize("MRQOL.Settings.Repairs.Enabled.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Repairs.Enabled.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "core.repairs.rounding", {
    name: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      round: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Choices.Round"),
      floor: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Choices.Floor"),
      ceil: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Choices.Ceil")
    },
    default: "round"
  });

    game.settings.register(MODULE_ID, "core.repairs.rounding", {
    name: "Repairs: Rounding",
    hint: "How to round the pip cost per repaired dot (10% of item cost).",
    scope: "world",
    config: true,
    type: String,
    choices: {
      round: "Nearest",
      floor: "Down",
      ceil: "Up"
    },
    default: "round"
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

    // Pips helpers (Broken / Empty indicator)
  game.settings.register(MODULE_ID, "core.pipsHelpers.enabled", {
    name: "Pips UI: Broken/Empty indicator",
    hint: "Show a Broken icon for weapons/armour and an Empty icon for other items when usage dots are fully marked.",
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

