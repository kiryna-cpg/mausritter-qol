# Mausritter QOL (Foundry VTT)

Quality-of-life features for the **Mausritter** system on **Foundry VTT v13**.

- **Module ID:** `mausritter-qol`
- **Current version:** `0.1.5`
- **Foundry compatibility:** `minimum: 13`, `verified: 13.351`
- **Languages:** EN / ES

> This module is organized in “packs” (Core / Automation / Integrations) that can be enabled/disabled from Module Settings.

---

## Features

### Core Pack (QOL)
- **Repairs UI**
  - Adds buttons to repair item usage dots according to Mausritter rules (repair cost is calculated from the item cost).
  - Provides confirmation dialogs with cost breakdown.
- **Inventory Layout + Rules**
  - Tracks item placement via flags (e.g. Carried/Worn/Pack/Grit/Bank) and applies placement rules.
  - Optional **snap** on drop to nearest valid slot.
  - Optional **strict overlap prevention** in non-Pack zones.
  - **Reorder inventory** button to auto-pack items into a valid grid layout and fix broken placement flags.
- **Encumbrance helper**
  - Applies/clears Encumbered via conditions based on inventory overflow.
  - Can **exclude Item Piles** / loot pile actors from Encumbered application.

### Automation Pack (Experimental)
- **Apply weapon damage from chat cards**
  - Adds an **Apply Damage** button to damage chat cards.
  - Optional **auto-apply** when exactly **one** token is targeted.
  - Applies damage to **HP** first, then overflow to an attribute (defaults to **STR**; can detect DEX/WIL overflow when described on the card).
  - Posts a small chat confirmation message after applying damage.
- **House rule option for STR 0**
  - Optional rule: when STR reaches 0, apply an alternative outcome (e.g. Unconscious + Injured) instead of RAW death.
  - Configurable scope (only characters / characters+hirelings / all creatures).

### Integrations Pack
- Reserved for optional integrations with other modules/systems features (disabled by default).

---

## Installation

1. Download the latest release `.zip`.
2. In Foundry: **Add-on Modules** → **Install Module**.
3. Install using the module manifest URL:
```txt
https://raw.githubusercontent.com/kiryna-cpg/mausritter-qol/main/module.json
```
4. Enable **Mausritter QOL** in your world.

---

## Configuration (Module Settings)

In **Game Settings → Configure Settings → Module Settings → Mausritter QOL**:

### Pack toggles
- **Core Pack** (`packs.core.enabled`) *(default: ON)*  
- **Automation Pack** (`packs.automation.enabled`) *(default: OFF)*  
- **Integrations Pack** (`packs.integrations.enabled`) *(default: OFF)*  

> Pack toggles require a **Reload Application**.

### Automation → Damage
- **Automation: Apply weapon damage** (`automation.damage.enabled`) *(default: ON)*
- **Automation: Auto-apply when 1 target** (`automation.damage.autoApply`) *(default: ON)*
- **Automation: Show 'Apply Damage' button** (`automation.damage.showButton`) *(default: ON)*

### Automation → STR 0 (House rule)
- **House rule enabled** (`automation.strZero.houseRule.enabled`) *(default: OFF)*
- **House rule applies to** (`automation.strZero.houseRule.scope`)
  - Only Mice (character)
  - Mice + Hirelings (character + hireling)
  - All creatures (character + hireling + creature)

### Core → Repairs
- **Repairs: Enable** (`core.repairs.enabled`) *(default: ON)*

### Core → Inventory Layout
- **Inventory Layout: Enable** (`core.inventoryLayout.enabled`) *(default: ON)*
- **Reorder button** (`core.inventoryLayout.reorderButton`) *(default: ON)*
- **Snap** (`core.inventoryLayout.snap`) *(default: ON)*
- **Prevent overlap in equipment** (`core.inventoryLayout.strict`) *(default: ON)*
- **Drop threshold** (`core.inventoryLayout.threshold`) *(default: 0.35)*

### Encumbrance
- **Exclude Item Piles** (`core.inventoryLayout.encumbrance.excludeItemPiles`) *(default: ON)*

---

## Usage

### Repairs
Open an item sheet with usage dots:
- Click **Repair 1 pip** to clear 1 marked usage dot.
- Click **Repair all** to clear all marked usage dots.
A confirmation dialog shows the computed cost and your available pips.

### Apply Damage (Automation)
1. Target **exactly one** token.
2. Roll an attack that produces a Mausritter damage chat card.
3. Click **Apply Damage** (or let it auto-apply if enabled).

Damage is applied to **HP first**, then overflow to an attribute.

### Reorder Inventory
On actor sheets that support it, use **Reorder inventory** to repack items into a valid layout and fix invalid placement flags.

---

## Localization

All user-facing strings are localized via Foundry i18n:
- `lang/en.json`
- `lang/es.json`

---

## Compatibility Notes

- Designed for **Foundry VTT v13**.
- Targets Mausritter system structure (e.g. HP at `actor.system.health.value`, attributes at `actor.system.stats.*.value`).
- Pack loading is isolated: if one pack fails to load, settings still register and other packs can continue to work.

---

## License

MIT.

---

## Contributing / Development

- ESModules code style.
- Keep UI strings in i18n (EN/ES).
- Avoid duplicate hook registrations and duplicate menu registrations.
- Prefer v13-correct and forward-compatible patterns.