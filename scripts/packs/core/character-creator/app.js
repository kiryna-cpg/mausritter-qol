import { MODULE_ID } from "../../../framework/paths.js";
import { rollAbilities, swapAbilities, rollHpAndPips, lookupBackground, getMaxAbility, getExtraBackgroundRule, rollDetails, rollNameParts, buildCharacterSystemData } from "./logic.js";
import { mrqolReorderInventoryForActorSheet } from "../index.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Character Creator wizard (ApplicationV2).
 *
 * Keep this file UI-focused. Put rules/roll logic in logic.js.
 */
export class MRQOLCharacterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "mrqol-character-creator",
    classes: ["mrqol", "mrqol-character-creator"],
    tag: "form",
    window: {
      title: "MRQOL.CharacterCreator.Title",
      icon: "fa-solid fa-wand-magic-sparkles",
      resizable: true
    },
    position: {
      width: 520,
      height: "auto"
    }
  };

  /** @override */
  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/character-creator/character-creator.hbs`
    }
  };

  constructor(options = {}) {
    super(options);

    /**
     * Minimal wizard state (will expand as we implement rolls/items).
     * @type {{ step: number, postToChat: boolean }}
     */
this.resetWizard();
this._createdThisSession = false;
this._suppressCloseConfirm = false;
 }

async #getWeaponOptions() {
  if (this._weaponOptions) return this._weaponOptions;

  const options = [];
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    // Prefer system packs; but accept any pack that contains weapon items.
    try {
      const index = await pack.getIndex({ fields: ["type", "name"] });
      const weaponRows = index.filter((e) => e.type === "weapon");
      if (!weaponRows.length) continue;

      for (const row of weaponRows) {
        options.push({
          uuid: `Compendium.${pack.collection}.${row._id}`,
          name: row.name
        });
      }
    } catch (_e) {
      // ignore packs we can't index
    }
  }

  // De-dupe by name
  const seen = new Set();
  const deduped = options.filter((o) => {
    const k = String(o.name).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort alphabetically
  deduped.sort((a, b) => a.name.localeCompare(b.name));

  this._weaponOptions = deduped;
  return deduped;
}

async #resolveItemDataByName(nameCandidates = []) {
  const lc = (s) => String(s ?? "").toLowerCase();

  // Build (name, typeHint) search variants from the raw candidate labels.
  const expandCandidates = (rawList) => {
    const out = [];
    const add = (name, typeHint = null) => {
      const n = String(name ?? "").trim();
      if (!n) return;
      out.push({ name: n, typeHint });
    };

    const stripParens = (s) => String(s ?? "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();

    const detect = (raw) => {
      const s = String(raw ?? "").trim();
      if (!s) return [];

      const variants = [];
      const sStripped = stripParens(s);

      // Type detection by prefix (EN/ES)
      const spellPrefix = /^(spell|hechizo)\s*:\s*/i;
      const hirelingPrefix = /^(hireling|ayudante)\s*:\s*/i;

      let typeHint = null;
      let base = s;

      if (spellPrefix.test(s)) {
        typeHint = "spell";
        base = s.replace(spellPrefix, "").trim();
      } else if (hirelingPrefix.test(s)) {
        // We are intentionally NOT creating hirelings in this step.
        // Return empty so caller can fallback to placeholder or skip.
        return [];
      }

      // Type detection by descriptors
      // weapons usually carry (Light, d6) / (pesada, 1d10) etc.
      // armour usually carries (Light armour) / (armad. ligera) etc.
      const lower = lc(s);
      const lowerStripped = lc(sStripped);

      if (!typeHint) {
        if (/\b(armour|armad\.)\b/i.test(s)) typeHint = "armor";
        else if (/\b(ligera|light|mediana|medium|pesada|heavy)\b/i.test(s) && /\b(d\d+|1d\d+)/i.test(s)) typeHint = "weapon";
      }

      // Prefer the cleanest base name for matching
      // 1) remove parentheses
      variants.push({ name: sStripped, typeHint });
      // 2) if there is still a prefix form (Spell/Hechizo), also try raw base
      if (base !== s) variants.push({ name: base, typeHint });

      // Special alias: Pole, 6" / Pértiga, 15 cm -> Wooden pole, 6"
      // (Gear list uses "Wooden pole, 6\""). :contentReference[oaicite:4]{index=4}
      if (lower === 'pole, 6"' || lowerStripped === 'pole, 6"' || lowerStripped === "pole, 6") {
        variants.push({ name: 'Wooden pole, 6"', typeHint: "item" });
      }
      if (lower === "pértiga, 15 cm" || lowerStripped === "pértiga, 15 cm") {
        variants.push({ name: 'Wooden pole, 6"', typeHint: "item" });
      }

      // Common armour strings sometimes include "Shield & jerkin" etc; ensure we try stripped
      // Add raw as last resort
      variants.push({ name: s, typeHint });

      return variants;
    };

    for (const raw of (rawList || []).map((s) => String(s ?? "").trim()).filter(Boolean)) {
      for (const v of detect(raw)) add(v.name, v.typeHint);
    }

    // De-dupe by (name,typeHint)
    const seen = new Set();
    return out.filter((e) => {
      const key = `${lc(e.name)}|${e.typeHint ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const expanded = expandCandidates(nameCandidates);

  // Helper: does an item match a candidate row?
  const matches = (docOrRow, cand) => {
    const n = lc(docOrRow?.name);
    if (n !== lc(cand.name)) return false;
    if (!cand.typeHint) return true;
    // If candidate has typeHint, require exact match.
    return lc(docOrRow?.type) === lc(cand.typeHint);
  };

  // 1) World items (Items sidebar)
  for (const cand of expanded) {
    const found = game.items?.find((i) => matches(i, cand));
    if (found) {
      const data = found.toObject();
      delete data._id;
      return data;
    }
  }

  // 2) Compendiums: scan all Item packs, but prefer those that look like "Gear", and also allow
  // matching by type (spell/armor/weapon/item).
  const packs = Array.from(game.packs).filter((p) => p.documentName === "Item");

  const scorePack = (pack) => {
    const label = `${pack.metadata?.label ?? ""} ${pack.collection ?? ""}`.toLowerCase();
    // Prefer Mausritter gear packs; generic heuristic.
    let score = 0;
    if (label.includes("gear")) score += 10;
    if (label.includes("mausritter")) score += 5;
    return score;
  };

  packs.sort((a, b) => scorePack(b) - scorePack(a));

  for (const pack of packs) {
    try {
      const index = await pack.getIndex({ fields: ["name", "type"] });

      for (const cand of expanded) {
        const row = index.find((e) => matches(e, cand));
        if (!row) continue;

        const uuid = `Compendium.${pack.collection}.${row._id}`;
        const doc = await fromUuid(uuid);
        if (doc) {
          const data = doc.toObject();
          delete data._id;
          return data;
        }
      }
    } catch (_e) {
      // ignore packs we can't index
    }
  }

  return null;
}

    /** @override */
    async _prepareContext(_options) {
    const weaponOptions = await this.#getWeaponOptions();

    return {
        moduleId: MODULE_ID,
        state: this.ccState,
        isStep1: this.ccState.step === 1,
        isStep2: this.ccState.step === 2,
        isStep3: this.ccState.step === 3,
        abilitiesReady: !!(this.ccState.abilityTotals.str && this.ccState.abilityTotals.dex && this.ccState.abilityTotals.wil),
        weaponOptions
    };
    }

  /** @override */
  _onRender(_context, _options) {
    // No-op for now. Hook point if we need post-render effects.
  }

  /** @override */
    _attachPartListeners(partId, html) {
    super._attachPartListeners(partId, html);

    // html is the root element for this rendered PART in ApplicationV2
    html.querySelectorAll("[data-action]")?.forEach((el) => {
        el.addEventListener("click", (ev) => this.#onAction(ev));
    });

    html.querySelector("[name='postToChat']")?.addEventListener("change", (ev) => {
        this.ccState.postToChat = !!ev.currentTarget?.checked;
    });

    html.querySelector("[name='swapA']")?.addEventListener("change", (ev) => {
  this.ccState.swapA = ev.currentTarget?.value ?? "str";

  // Prevent same selection
  if (this.ccState.swapA === this.ccState.swapB) {
    this.ccState.swapB = (this.ccState.swapA === "str") ? "dex" : "str";
  }

  this.render({ force: true });
});

    html.querySelector("[name='swapB']")?.addEventListener("change", (ev) => {
  this.ccState.swapB = ev.currentTarget?.value ?? "dex";

  // Prevent same selection
  if (this.ccState.swapA === this.ccState.swapB) {
    this.ccState.swapA = (this.ccState.swapB === "str") ? "dex" : "str";
  }

  this.render({ force: true });
});

    html.querySelector("[name='extraPick']")?.addEventListener("change", (ev) => {
      this.ccState.extraPick = ev.currentTarget?.value ?? "A";
    });

    html.querySelector("[name='ccName']")?.addEventListener("input", (ev) => {
      this.ccState.name = ev.currentTarget?.value ?? "";
    });

    html.querySelector("[name='weaponUuid']")?.addEventListener("change", (ev) => {
      this.ccState.weaponUuid = ev.currentTarget?.value ?? "";
    });

}

#hasProgress() {
  const s = this.ccState;

  // Any roll / result counts as progress
  if (s?.abilities?.str || s?.abilities?.dex || s?.abilities?.wil) return true;
  if (Number.isFinite(s?.hp) || Number.isFinite(s?.pips)) return true;
  if (s?.background) return true;
  if (s?.extraBackground) return true;
  if (s?.details?.resolved?.birth) return true;
  if (s?.nameParts?.keys?.birthnameKey || s?.nameParts?.keys?.matrinameKey) return true;

  // Any user input / selection counts too
  if ((s?.name ?? "").trim()) return true;
  if ((s?.weaponUuid ?? "").trim()) return true;

  // If they navigated beyond step 1, also counts
  if ((s?.step ?? 1) > 1) return true;

  return false;
}

  async #onAction(event) {
    event.preventDefault();
    const action = event.currentTarget?.dataset?.action;
    if (!action) return;

    switch (action) {
      case "prev":
        this.ccState.step = Math.max(1, this.ccState.step - 1);
        return this.render({ force: true });

      case "next":
        this.ccState.step = Math.min(3, this.ccState.step + 1);
        return this.render({ force: true });

      case "close":
        return this.close();

      // Placeholders (implemented later)
    case "roll-abilities": {
    const rolled = await rollAbilities();
    this.ccState.abilities = rolled;
    // Store "base" totals for Reset (before any swap)
    this.ccState.abilityTotalsBase = {
    str: rolled.str.total,
    dex: rolled.dex.total,
    wil: rolled.wil.total
    };
    this.ccState.abilitiesSwapped = false;

// Post rolls to chat (dice-visible)
if (this.ccState.postToChat) {
  const speaker = ChatMessage.getSpeaker();
  await rolled.str.roll.toMessage({
    speaker,
    flavor: game.i18n.localize("MRQOL.CharacterCreator.Abilities.ChatSTR")
  });
  await rolled.dex.roll.toMessage({
    speaker,
    flavor: game.i18n.localize("MRQOL.CharacterCreator.Abilities.ChatDEX")
  });
  await rolled.wil.roll.toMessage({
    speaker,
    flavor: game.i18n.localize("MRQOL.CharacterCreator.Abilities.ChatWIL")
  });
}
    this.ccState.abilityTotals = {
        str: rolled.str.total,
        dex: rolled.dex.total,
        wil: rolled.wil.total
    };
    return this.render({ force: true });
    }

    case "swap-abilities": {
    // Block after one swap
    if (this.ccState.abilitiesSwapped) {
        ui.notifications.warn(game.i18n.localize("MRQOL.CharacterCreator.Abilities.SwapOnlyOnce"));
        return;
    }

    // Only swap after rolling
    if (!this.ccState.abilityTotals?.str) {
        ui.notifications.warn(game.i18n.localize("MRQOL.CharacterCreator.Abilities.RollFirst"));
        return;
    }

    const a = this.ccState.swapA;
    const b = this.ccState.swapB;

    swapAbilities(this.ccState.abilityTotals, a, b);
    this.ccState.abilitiesSwapped = true;

    return this.render({ force: true });
    }

    case "reset-abilities": {
    if (!this.ccState.abilityTotalsBase?.str) {
        ui.notifications.warn(game.i18n.localize("MRQOL.CharacterCreator.Abilities.RollFirst"));
        return;
    }

    this.ccState.abilityTotals = {
        str: this.ccState.abilityTotalsBase.str,
        dex: this.ccState.abilityTotalsBase.dex,
        wil: this.ccState.abilityTotalsBase.wil
    };

    this.ccState.abilitiesSwapped = false;

    // Restore default swap dropdowns (optional but helps UX)
    this.ccState.swapA = "str";
    this.ccState.swapB = "dex";

    return this.render({ force: true });
    }

case "roll-hp-pips": {
  // Require abilities (step 1) because extra rule depends on max stat
  if (!this.ccState?.abilityTotals?.str) {
    ui.notifications.warn(game.i18n.localize("MRQOL.CharacterCreator.Background.RollNeedsAbilities"));
    return;
  }

  const { hpRoll, pipsRoll, hp, pips } = await rollHpAndPips();

  this.ccState.hpRoll = hpRoll;
  this.ccState.pipsRoll = pipsRoll;
  this.ccState.hp = hp;
  this.ccState.pips = pips;

  this.ccState.background = lookupBackground(hp, pips);

  // Compute extra background rule from max stat (after swap)
  const maxAbility = getMaxAbility(this.ccState.abilityTotals);
  this.ccState.extraRule = getExtraBackgroundRule(maxAbility);

  // Reset any previous extra background roll when re-rolling base HP/Pips
  this.ccState.extraHp = null;
  this.ccState.extraPips = null;
  this.ccState.extraHpRoll = null;
  this.ccState.extraPipsRoll = null;
  this.ccState.extraBackground = null;
  this.ccState.extraPick = "A";

  // Post rolls to chat (dice-visible)
  if (this.ccState.postToChat) {
    const speaker = ChatMessage.getSpeaker();
    await hpRoll.toMessage({ speaker, flavor: game.i18n.localize("MRQOL.CharacterCreator.Background.ChatHP") });
    await pipsRoll.toMessage({ speaker, flavor: game.i18n.localize("MRQOL.CharacterCreator.Background.ChatPips") });
  }

  return this.render({ force: true });
}

case "roll-extra-background": {
  if (!this.ccState.extraRule?.enabled) {
    ui.notifications.warn(game.i18n.localize("MRQOL.CharacterCreator.Background.ExtraNotEligible"));
    return;
  }

  const { hpRoll, pipsRoll, hp, pips } = await rollHpAndPips();

  this.ccState.extraHpRoll = hpRoll;
  this.ccState.extraPipsRoll = pipsRoll;
  this.ccState.extraHp = hp;
  this.ccState.extraPips = pips;
  this.ccState.extraBackground = lookupBackground(hp, pips);

  // Post rolls to chat (dice-visible)
  if (this.ccState.postToChat) {
    const speaker = ChatMessage.getSpeaker();
    await hpRoll.toMessage({ speaker, flavor: game.i18n.localize("MRQOL.CharacterCreator.Background.ChatExtraHP") });
    await pipsRoll.toMessage({ speaker, flavor: game.i18n.localize("MRQOL.CharacterCreator.Background.ChatExtraPips") });
  }

  return this.render({ force: true });
}

case "roll-details": {
  const details = await rollDetails();
  const nameParts = await rollNameParts();
this.ccState.nameParts = nameParts;

// Autocomplete: if name field is empty, set a suggested full name
const birth = game.i18n.localize(nameParts.keys.birthnameKey);
const family = game.i18n.localize(nameParts.keys.matrinameKey);
const suggested = `${birth} ${family}`;

if (!this.ccState.name?.trim()) {
  this.ccState.name = suggested;
  this.ccState.nameAuto = true;
}

  this.ccState.details = details;

  if (this.ccState.postToChat) {
    const speaker = ChatMessage.getSpeaker();

    await details.rolls.birthRoll.toMessage({
      speaker,
      flavor: game.i18n.localize("MRQOL.CharacterCreator.Details.ChatBirthsign")
    });

    await details.rolls.colorRoll.toMessage({
      speaker,
      flavor: game.i18n.localize("MRQOL.CharacterCreator.Details.ChatCoatColor")
    });

    await details.rolls.patternRoll.toMessage({
      speaker,
      flavor: game.i18n.localize("MRQOL.CharacterCreator.Details.ChatCoatPattern")
    });

    await details.rolls.physicalRoll.toMessage({
      speaker,
      flavor: game.i18n.localize("MRQOL.CharacterCreator.Details.ChatPhysical")
    });

    await nameParts.rolls.birthRoll.toMessage({
    speaker,
    flavor: game.i18n.localize("MRQOL.CharacterCreator.Details.ChatBirthname")
    });

    await nameParts.rolls.familyRoll.toMessage({
    speaker,
    flavor: game.i18n.localize("MRQOL.CharacterCreator.Details.ChatMatriname")
    });
  }

  return this.render({ force: true });
}

case "create": {
  // Basic validations
  if (!this.ccState?.abilityTotals?.str || !this.ccState?.hp || !this.ccState?.pips || !this.ccState?.background) {
    ui.notifications.warn(game.i18n.localize("MRQOL.CharacterCreator.CreateMissing"));
    return;
  }
  if (!this.ccState.weaponUuid) {
    ui.notifications.warn(game.i18n.localize("MRQOL.CharacterCreator.Weapon.Required"));
    return;
  }
  if (!this.ccState.details?.resolved?.birth) {
    ui.notifications.warn(game.i18n.localize("MRQOL.CharacterCreator.Details.Required"));
    return;
  }

  const name = (this.ccState.name?.trim() || game.i18n.localize("MRQOL.CharacterCreator.DefaultName"));

  // Resolve localized strings for actor description
  const bgName = game.i18n.localize(this.ccState.background.nameKey);
  const birthName = game.i18n.localize(this.ccState.details.resolved.birth.nameKey);
  const birthDisp = game.i18n.localize(this.ccState.details.resolved.birth.dispKey);
  const coatColor = game.i18n.localize(this.ccState.details.resolved.color.nameKey);
  const coatPattern = game.i18n.localize(this.ccState.details.resolved.pattern.nameKey);
  const physical = this.ccState.details.resolved.physicalKey
    ? game.i18n.localize(this.ccState.details.resolved.physicalKey)
    : "";

  const systemData = buildCharacterSystemData({
    abilityTotals: this.ccState.abilityTotals,
    hp: this.ccState.hp,
    pips: this.ccState.pips,
    backgroundText: bgName,
    birthsignText: `${birthName} (${birthDisp})`,
    coatText: `${coatColor}, ${coatPattern}`,
    lookText: physical
  });

  // Create actor
  const actor = await Actor.create({
    name,
    type: "character",
    system: systemData,
    flags: {
      [MODULE_ID]: {
        characterCreator: {
          version: "0.1.6",
          snapshot: foundry.utils.deepClone(this.ccState)
        }
      }
    }
  });

  if (!actor) return;

  // Create starting items (minimal v1):
  // - Weapon: clone from selected UUID
  // - Torches + Rations (fallback text items if compendium lookup fails)
  // - Background items as simple "item" placeholders (so the player sees them)
const itemsToCreate = [];

// Weapon from UUID (already working)
const weaponDoc = await fromUuid(this.ccState.weaponUuid);
if (weaponDoc) {
  const weaponData = weaponDoc.toObject();
  delete weaponData._id;
  itemsToCreate.push(weaponData);
}

// Helper to push resolved item or placeholder
const pushResolved = async (nameCandidates, fallbackName) => {
  const resolved = await this.#resolveItemDataByName(nameCandidates);
  if (resolved) {
    itemsToCreate.push(resolved);
  } else {
    itemsToCreate.push({
      name: fallbackName,
      type: "item",
      system: { placement: "pack" }
    });
  }
};

// Torches / Rations (resolve if possible)
await pushResolved(
  ["Torches", game.i18n.localize("MRQOL.CharacterCreator.Starting.Torches")],
  game.i18n.localize("MRQOL.CharacterCreator.Starting.Torches")
);

await pushResolved(
  ["Rations", game.i18n.localize("MRQOL.CharacterCreator.Starting.Rations")],
  game.i18n.localize("MRQOL.CharacterCreator.Starting.Rations")
);

// Background A/B (use canonical EN from data.js + localized)
await pushResolved(
  [this.ccState.background.en?.itemA, game.i18n.localize(this.ccState.background.itemAKey)],
  game.i18n.localize(this.ccState.background.itemAKey)
);

await pushResolved(
  [this.ccState.background.en?.itemB, game.i18n.localize(this.ccState.background.itemBKey)],
  game.i18n.localize(this.ccState.background.itemBKey)
);

// Extra background items, if present
if (this.ccState.extraBackground) {
  if (this.ccState.extraRule?.takeBoth) {
    await pushResolved(
      [this.ccState.extraBackground.en?.itemA, game.i18n.localize(this.ccState.extraBackground.itemAKey)],
      game.i18n.localize(this.ccState.extraBackground.itemAKey)
    );
    await pushResolved(
      [this.ccState.extraBackground.en?.itemB, game.i18n.localize(this.ccState.extraBackground.itemBKey)],
      game.i18n.localize(this.ccState.extraBackground.itemBKey)
    );
  } else {
    const pickKey = (this.ccState.extraPick === "B") ? this.ccState.extraBackground.itemBKey : this.ccState.extraBackground.itemAKey;
    const pickEn = (this.ccState.extraPick === "B") ? this.ccState.extraBackground.en?.itemB : this.ccState.extraBackground.en?.itemA;

    await pushResolved(
      [pickEn, game.i18n.localize(pickKey)],
      game.i18n.localize(pickKey)
    );
  }
}
  if (itemsToCreate.length) await actor.createEmbeddedDocuments("Item", itemsToCreate);

    // Auto-reorder inventory so everything snaps into the right slots on first open.
    // Never let reorder failures block closing/reset.
    try {
    await mrqolReorderInventoryForActorSheet(actor);
    } catch (err) {
    console.warn(`${MODULE_ID} | Auto-reorder failed`, err);
    }

  // Open sheet
  await actor.sheet?.render(true);

  // Optional: post summary card (no dice, just recap)
  if (this.ccState.postToChat) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="mrqol-cc-summary">
        <strong>${game.i18n.localize("MRQOL.CharacterCreator.Summary.Title")}</strong><br/>
        ${game.i18n.localize("MRQOL.CharacterCreator.Summary.Background")}: ${bgName}<br/>
        STR ${this.ccState.abilityTotals.str} / DEX ${this.ccState.abilityTotals.dex} / WIL ${this.ccState.abilityTotals.wil}<br/>
        ${game.i18n.localize("MRQOL.CharacterCreator.Background.HP")}: ${this.ccState.hp} — ${game.i18n.localize("MRQOL.CharacterCreator.Background.Pips")}: ${this.ccState.pips}
      </div>`
    });
  }

this._createdThisSession = true;

// Reset wizard state ONLY after successful creation
this.resetWizard();

// Close without exit confirmation
this._suppressCloseConfirm = true;
return this.close();
}
    }
  }

  resetWizard() {
  // Keep postToChat default ON, as per your requirement that rolls are visible.
  this.ccState = {
    step: 1,
    postToChat: true,

    // Step 1
    abilities: { str: null, dex: null, wil: null },
    abilityTotals: { str: null, dex: null, wil: null },
    abilityTotalsBase: { str: null, dex: null, wil: null },
    abilitiesSwapped: false,
    swapA: "str",
    swapB: "dex",

    // Step 2
    hp: null,
    pips: null,
    hpRoll: null,
    pipsRoll: null,
    background: null,
    extraRule: { enabled: false, takeBoth: false },
    extraHp: null,
    extraPips: null,
    extraHpRoll: null,
    extraPipsRoll: null,
    extraBackground: null,
    extraPick: "A",

    // Step 3
    name: "",
    weaponUuid: "",
    details: {
      rolls: null,
      values: null,
      resolved: { birth: null, color: null, pattern: null, physicalKey: null }
    },
    nameParts: {
      rolls: null,
      values: null,
      keys: { birthnameKey: null, matrinameKey: null }
    },
    nameAuto: false
  };
}

/** @override */
async close(options = {}) {
  // If we explicitly suppress confirmation (used after Create Actor), just close.
  if (this._suppressCloseConfirm) {
    this._suppressCloseConfirm = false;
    return super.close(options);
  }

  // If no actor was created and the user has made progress, confirm before closing.
  if (!this._createdThisSession && this.#hasProgress()) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("MRQOL.CharacterCreator.ConfirmExit.Title") },
      content: `<p>${game.i18n.localize("MRQOL.CharacterCreator.ConfirmExit.Body")}</p>`,
      yes: { label: game.i18n.localize("MRQOL.CharacterCreator.ConfirmExit.Yes") },
      no: { label: game.i18n.localize("MRQOL.CharacterCreator.ConfirmExit.No") }
    });

    if (!confirmed) return; // user chose to stay
  }

  // IMPORTANT: do NOT reset here (so user can continue later)
  return super.close(options);
}

}