# Changelog
All notable changes to this project will be documented in this file.

The format is based on *Keep a Changelog*,
and this project adheres to *Semantic Versioning*.

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