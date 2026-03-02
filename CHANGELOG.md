# Changelog
All notable changes to this project will be documented in this file.

The format is based on *Keep a Changelog*,
and this project adheres to *Semantic Versioning*.

## [0.1.6] - 2026-03-02
### Added
- Core: Pips UI helpers (actor + item)
  - Broken/Empty indicator when usage pips are fully marked (`value === max`).
  - Weapons/Armour show **Broken**; other items show **Empty**.
  - Red overlay badge on inventory item cards (normal + overflow) with tooltip.
  - Red overlay badge on Item Sheet image with tooltip.
  - New icons: `/assets/icons/Broken.png`, `/assets/icons/Empty.png`.
  - New setting: `core.pipsHelpers.enabled`.

- Core: Equip/Unequip UI improvements
  - Equip toggle icons by type/tag:
    - armour: `fa-shield-halved`
    - weapons: `fa-shirt`
    - tag "ammunition": `fa-bow-arrow`
    - condition: `fa-bolt`
    - spell: `fa-hand-sparkles`
  - Spell equip support: spells equip to **Carried** and toggle back to **Pack**.
  - New i18n message: `MRQOL.Inventory.NoSpaceEquipSpell`.

- Automation: Rest UI (GM)
  - Actor sheet header buttons: Short / Long / Full Rest.
  - Applies Mausritter rest rules and posts a clear chat log.
  - New setting: `automation.rest.enabled`.

- Automation: Wear automation phase 1
  - End of combat: simple wear heuristic (roll d6; 4–6 marks usage) for weapons/armour and optional ammo.
  - Spell casting: marks spell usage from existing chat roll results (no re-roll).
  - Configurable options:
    - `automation.wear.enabled`
    - `automation.wear.combat.equippedOnly`
    - `automation.wear.combat.includeAmmo`
    - `automation.wear.combat.alwaysMarkSilvered`
    - `automation.wear.spells.enabled`

- UI: Game Paused icon override
  - Replaces the default pause icon (clockwork) with `/assets/icons/mouse-icon.png`.
  - Keeps existing pause behavior (including spin).

### Changed
- Pause icon is enforced via `renderPause` to avoid being overridden by core/system.
- Item Sheet usage indicator moved to an overlay on top of the item image (no layout/size changes).

### Fixed
- Foundry v13 compatibility: removed deprecated async roll evaluation usage (uses sync evaluation where needed).
- Spell equip toggle now correctly de-equips back to Pack after being equipped in Carried.
- Usage indicator tooltips now work on hover (inventory cards + item sheet).

## [0.1.5] - 2026-02-22
### Added
- Pack-based module structure with independent toggles:
  - Core Pack (QOL)
  - Automation Pack (experimental)
  - Integrations Pack (optional)
- Repairs UI:
  - “Repair 1 pip” and “Repair all” actions with confirmation dialog and cost breakdown.
- Inventory Layout + Rules:
  - Placement tracking via flags and rule enforcement.
  - Optional “Snap” on drop.
  - Optional overlap prevention for non-Pack zones.
  - “Reorder inventory” sheet header button to repack items and repair invalid flags.
- Encumbrance helper with an option to exclude Item Piles / loot pile actors.
- Automation: Apply weapon damage from chat cards:
  - “Apply Damage” button on damage cards.
  - Optional auto-apply when exactly one token is targeted.
  - HP-first damage with overflow to an attribute (default STR; supports DEX/WIL overflow cues).
  - Chat feedback message after applying damage.
- Automation: Optional STR 0 house rule with configurable scope.

### Changed
- Pack loading uses guarded dynamic imports so settings still register even if a pack fails to load.

### Fixed
- N/A (first documented release).