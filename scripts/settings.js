import { MODULE_ID } from "./framework/paths.js";
import { MRQOLSettingsApp } from "./apps/mrqol-settings-app.js";

export function registerSettings() {
  // ------------------------------------------------------------
  // Settings Menu (Configure...)
  // ------------------------------------------------------------
  game.settings.registerMenu(MODULE_ID, "settings.configure", {
    name: game.i18n.localize("MRQOL.Settings.Menu.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Menu.Hint"),
    label: game.i18n.localize("MRQOL.Settings.Menu.Label"),
    icon: "fas fa-cog",
    type: MRQOLSettingsApp,
    restricted: true
  });

  // ------------------------------------------------------------
  // Client: Language preference for sync button
  // (keep visible; frequently used per-user)
  // ------------------------------------------------------------
  game.settings.register(MODULE_ID, "i18nSync.preferredLang", {
    name: game.i18n.localize("MRQOL.Settings.I18nSync.PreferredLang.Name"),
    hint: game.i18n.localize("MRQOL.Settings.I18nSync.PreferredLang.Hint"),
    scope: "client",
    config: true,
    type: String,
    choices: {
      world: game.i18n.localize("MRQOL.Settings.I18nSync.PreferredLang.Choices.World"),
      en: game.i18n.localize("MRQOL.Settings.I18nSync.PreferredLang.Choices.En"),
      es: game.i18n.localize("MRQOL.Settings.I18nSync.PreferredLang.Choices.Es")
    },
    default: "world"
  });

  // ------------------------------------------------------------
  // World: Master toggles (keep visible; “top level”)
  // ------------------------------------------------------------
  game.settings.register(MODULE_ID, "packs.core.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Packs.Core.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Packs.Core.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, "packs.automation.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Packs.Automation.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Packs.Automation.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, "packs.integrations.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Packs.Integrations.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Packs.Integrations.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true
  });

  // ------------------------------------------------------------
  // World: High-level feature toggles (keep visible)
  // ------------------------------------------------------------
  game.settings.register(MODULE_ID, "automation.damage.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Automation.Damage.Enabled.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Automation.Damage.Enabled.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.rest.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Automation.Rest.Enabled.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Automation.Rest.Enabled.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "core.inventoryLayout.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Core.InventoryLayout.Enabled.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Core.InventoryLayout.Enabled.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // ============================================================
  // Everything below is configured via the MRQOL "Configure..." UI
  // ============================================================

  /* -------------------------------------------- */
  /* Automation: Damage application               */
  /* -------------------------------------------- */

  game.settings.register(MODULE_ID, "automation.damage.autoApply", {
    name: game.i18n.localize("MRQOL.Settings.Fields.automation.damage.autoApply.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.automation.damage.autoApply.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.damage.showButton", {
    name: game.i18n.localize("MRQOL.Settings.Fields.automation.damage.showButton.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.automation.damage.showButton.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  /* -------------------------------------------- */
  /* Automation: Wear (usage)                     */
  /* -------------------------------------------- */

  game.settings.register(MODULE_ID, "automation.wear.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.enabled.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.enabled.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.wear.combat.equippedOnly", {
    name: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.combat.equippedOnly.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.combat.equippedOnly.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.wear.combat.includeAmmo", {
    name: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.combat.includeAmmo.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.combat.includeAmmo.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.wear.combat.alwaysMarkSilvered", {
    name: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.combat.alwaysMarkSilvered.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.combat.alwaysMarkSilvered.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "automation.wear.spells.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.spells.enabled.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.automation.wear.spells.enabled.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  /* -------------------------------------------- */
  /* Automation: STR 0 rule                       */
  /* -------------------------------------------- */

  game.settings.register(MODULE_ID, "automation.strZero.houseRule.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Fields.automation.strZero.houseRule.enabled.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.automation.strZero.houseRule.enabled.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "automation.strZero.houseRule.scope", {
    name: game.i18n.localize("MRQOL.Settings.Fields.automation.strZero.houseRule.scope.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.automation.strZero.houseRule.scope.Hint"),
    scope: "world",
    config: false,
    type: String,
    choices: {
      characters: game.i18n.localize("MRQOL.Settings.Fields.automation.strZero.houseRule.scope.Choices.characters"),
      charactersHirelings: game.i18n.localize("MRQOL.Settings.Fields.automation.strZero.houseRule.scope.Choices.charactersHirelings"),
      allCreatures: game.i18n.localize("MRQOL.Settings.Fields.automation.strZero.houseRule.scope.Choices.allCreatures")
    },
    default: "characters"
  });

  /* -------------------------------------------- */
  /* Core: Repairs                                */
  /* -------------------------------------------- */

  game.settings.register(MODULE_ID, "core.repairs.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Repairs.Enabled.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Repairs.Enabled.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "core.repairs.rounding", {
    name: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Hint"),
    scope: "world",
    config: false,
    type: String,
    choices: {
      round: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Choices.Round"),
      floor: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Choices.Floor"),
      ceil: game.i18n.localize("MRQOL.Settings.Repairs.Rounding.Choices.Ceil")
    },
    default: "round"
  });

  /* -------------------------------------------- */
  /* Core: Pips helpers                           */
  /* -------------------------------------------- */

  game.settings.register(MODULE_ID, "core.pipsHelpers.enabled", {
    name: game.i18n.localize("MRQOL.Settings.Fields.core.pipsHelpers.enabled.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.core.pipsHelpers.enabled.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  /* -------------------------------------------- */
  /* Core: Inventory layout / rules               */
  /* -------------------------------------------- */

  game.settings.register(MODULE_ID, "core.inventoryLayout.reorderButton", {
    name: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.reorderButton.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.reorderButton.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "core.inventoryLayout.snap", {
    name: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.snap.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.snap.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "core.inventoryLayout.strict", {
    name: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.strict.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.strict.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "core.inventoryLayout.threshold", {
    name: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.threshold.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.threshold.Hint"),
    scope: "world",
    config: false,
    type: Number,
    range: { min: 0.1, max: 0.9, step: 0.05 },
    default: 0.35
  });

  game.settings.register(MODULE_ID, "core.inventoryLayout.encumbrance.excludeItemPiles", {
    name: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.encumbrance.excludeItemPiles.Name"),
    hint: game.i18n.localize("MRQOL.Settings.Fields.core.inventoryLayout.encumbrance.excludeItemPiles.Hint"),
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });
}