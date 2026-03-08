import { MODULE_ID } from "../framework/paths.js";

/**
 * Settings UI with tabs (Core / Automation / Integrations / Advanced).
 * Keeps Foundry's native Module Settings list short.
 */
export class MRQOLSettingsApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mrqol-settings-app",
      title: game.i18n.localize("MRQOL.Settings.Menu.Title"),
      template: `modules/${MODULE_ID}/templates/settings/settings-app.hbs`,
      width: 720,
      height: "auto",
      closeOnSubmit: true,
      submitOnClose: false,
      tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "core" }]
    });
  }

  /** Encode dotted setting keys so we can use simple flat form fields. */
  static encodeKey(key) {
    return key.replaceAll(".", "__");
  }

  /** Settings layout for the custom UI. */
  static get SCHEMA() {
    return [
      {
        tab: "core",
        title: "MRQOL.Settings.Tabs.Core",
        sections: [
          {
            title: "MRQOL.Settings.Sections.Core.Repairs",
            settings: ["core.repairs.enabled", "core.repairs.rounding"]
          },
          {
            title: "MRQOL.Settings.Sections.Core.Inventory",
            settings: [
              "core.inventoryLayout.reorderButton",
              "core.inventoryLayout.snap",
              "core.inventoryLayout.strict",
              "core.inventoryLayout.threshold"
            ]
          },
          {
            title: "MRQOL.Settings.Sections.Core.UI",
            settings: ["core.pipsHelpers.enabled"]
          }
        ]
      },
      {
        tab: "automation",
        title: "MRQOL.Settings.Tabs.Automation",
        sections: [
          {
            title: "MRQOL.Settings.Sections.Automation.Damage",
            settings: ["automation.damage.autoApply", "automation.damage.showButton"]
          },
          {
            title: "MRQOL.Settings.Sections.Automation.Wear",
            settings: [
              "automation.wear.enabled",
              "automation.wear.combat.equippedOnly",
              "automation.wear.combat.includeAmmo",
              "automation.wear.combat.alwaysMarkSilvered",
              "automation.wear.spells.enabled"
            ]
          },
          {
            title: "MRQOL.Settings.Sections.Automation.StrZero",
            settings: ["automation.strZero.houseRule.enabled", "automation.strZero.houseRule.scope"]
          }
        ]
      },
      {
        tab: "integrations",
        title: "MRQOL.Settings.Tabs.Integrations",
        sections: [
          {
            title: "MRQOL.Settings.Sections.Integrations.Encumbrance",
            settings: ["core.inventoryLayout.encumbrance.excludeItemPiles"]
          }
        ]
      },
      {
        tab: "advanced",
        title: "MRQOL.Settings.Tabs.Advanced",
        sections: [
          {
            title: "MRQOL.Settings.Sections.Advanced.About",
            htmlHint: "MRQOL.Settings.Advanced.Hint",
            settings: []
          }
        ]
      }
    ];
  }

  static allSettingKeys() {
    return this.SCHEMA.flatMap((tab) => tab.sections.flatMap((section) => section.settings));
  }

  static getControlType(reg) {
    if (reg?.choices && Object.keys(reg.choices).length) return "select";
    if (reg?.range) return "range";
    if (reg?.type === Boolean) return "boolean";
    return "text";
  }

  static localizeMaybe(value) {
    if (typeof value !== "string" || !value) return value ?? "";
    return game.i18n.localize(value);
  }  

  getData() {
    const isGM = game.user.isGM;

    const packs = {
      core: game.settings.get(MODULE_ID, "packs.core.enabled"),
      automation: game.settings.get(MODULE_ID, "packs.automation.enabled"),
      integrations: game.settings.get(MODULE_ID, "packs.integrations.enabled")
    };

    const tabPack = {
      core: "core",
      automation: "automation",
      integrations: "integrations",
      advanced: null
    };

    const schema = MRQOLSettingsApp.SCHEMA.map((tab) => {
      const requiredPack = tabPack[tab.tab];
      const packEnabled = requiredPack ? packs[requiredPack] : true;

      const notice = requiredPack && !packEnabled
        ? game.i18n.localize(`MRQOL.Settings.PackDisabledNotice.${requiredPack}`)
        : null;

      const sections = tab.sections.map((section) => {
        const settings = section.settings
          .map((key) => {
            const fullKey = `${MODULE_ID}.${key}`;
            const reg = game.settings.settings.get(fullKey);
            if (!reg) return null;

            const value = game.settings.get(MODULE_ID, key);
            const type = MRQOLSettingsApp.getControlType(reg);
            const encoded = MRQOLSettingsApp.encodeKey(key);
            const disabledByScope = !isGM && reg.scope === "world";
            const disabledByPack = requiredPack ? !packEnabled : false;

            const out = {
              key,
              encoded,
              type,
              label: MRQOLSettingsApp.localizeMaybe(reg.name ?? key),
              hint: MRQOLSettingsApp.localizeMaybe(reg.hint ?? ""),
              value,
              disabled: disabledByScope || disabledByPack,
              isWorld: reg.scope === "world"
            };

            if (type === "select") {
              out.selectChoices = Object.entries(reg.choices ?? {}).map(([choiceValue, choiceLabel]) => ({
                value: choiceValue,
                label: MRQOLSettingsApp.localizeMaybe(choiceLabel)
              }));
            }

            if (type === "range") {
              out.min = reg.range?.min;
              out.max = reg.range?.max;
              out.step = reg.range?.step;
            }

            return out;
          })
          .filter(Boolean);

        return {
          title: game.i18n.localize(section.title),
          htmlHint: section.htmlHint ? game.i18n.localize(section.htmlHint) : null,
          settings
        };
      });

      return {
        tab: tab.tab,
        title: game.i18n.localize(tab.title),
        notice,
        sections
      };
    });

    return { schema };
  }

  activateListeners(html) {
    super.activateListeners(html);

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root?.querySelectorAll) return;

    root.querySelectorAll('input[type="range"]').forEach((input) => {
      const valueEl = input.closest(".form-fields")?.querySelector(".range-value");
      if (!valueEl) return;

      const syncValue = () => {
        valueEl.textContent = input.value;
      };

      input.addEventListener("input", syncValue);
      syncValue();
    });
  }

  async _updateObject(_event, _formData) {
    const form = this.form;
    if (!form) return;

    const updates = [];

    for (const key of MRQOLSettingsApp.allSettingKeys()) {
      const reg = game.settings.settings.get(`${MODULE_ID}.${key}`);
      if (!reg) continue;

      const encoded = MRQOLSettingsApp.encodeKey(key);
      const field = form.elements.namedItem(encoded);
      if (!field || field.disabled) continue;

      let value;
      if (reg.type === Boolean) value = !!field.checked;
      else if (reg.type === Number) value = Number(field.value);
      else if (reg.type === String) value = String(field.value);
      else value = field.value;

      updates.push({ key, value });
    }

    for (const update of updates) {
      await game.settings.set(MODULE_ID, update.key, update.value);
    }
  }
}