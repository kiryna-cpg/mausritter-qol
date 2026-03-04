/**
 * Character Creator rules and roll logic.
 *
 * Keep this file "pure-ish": return data, don't touch the UI.
 */

/**
 * Roll 3d6 and keep the best two dice (Mausritter ability roll).
 * @returns {Promise<{roll: Roll, results: number[], kept: number[], total: number}>}
 */
export async function roll3d6KeepBest2() {
  const roll = new Roll("3d6");
  await roll.evaluate({ allowInteractive: true });

  // Extract individual d6 results safely
  const die = roll.dice?.[0];
  const results = (die?.results ?? []).map((r) => Number(r.result)).filter((n) => Number.isFinite(n));

  // Fallback if something weird happens
  while (results.length < 3) results.push(1);

  const sorted = [...results].sort((a, b) => b - a);
  const kept = sorted.slice(0, 2);
  const total = kept[0] + kept[1];

  return { roll, results, kept, total };
}

/**
 * Roll STR/DEX/WIL in order.
 * @returns {Promise<{str: object, dex: object, wil: object}>}
 */
export async function rollAbilities() {
  return {
    str: await roll3d6KeepBest2(),
    dex: await roll3d6KeepBest2(),
    wil: await roll3d6KeepBest2()
  };
}

/**
 * Swap two ability keys in-place.
 * @param {{str:number, dex:number, wil:number}} totals
 * @param {"str"|"dex"|"wil"} a
 * @param {"str"|"dex"|"wil"} b
 */
export function swapAbilities(totals, a, b) {
  if (!a || !b || a === b) return;
  const tmp = totals[a];
  totals[a] = totals[b];
  totals[b] = tmp;
}

import { getBackgroundEntry, BIRTHSIGNS, COAT_COLORS, COAT_PATTERNS, getPhysicalDetailKey, getBirthnameKey, getMatrinameKey } from "./data.js";

/**
 * Roll HP (1d6) and Pips (1d6).
 * @returns {Promise<{hpRoll: Roll, pipsRoll: Roll, hp: number, pips: number}>}
 */
export async function rollHpAndPips() {
  const hpRoll = new Roll("1d6");
  await hpRoll.evaluate({ allowInteractive: true });

  const pipsRoll = new Roll("1d6");
  await pipsRoll.evaluate({ allowInteractive: true });

  return { hpRoll, pipsRoll, hp: Number(hpRoll.total), pips: Number(pipsRoll.total) };
}

/**
 * Lookup background table entry from HP/Pips.
 * @returns {ReturnType<typeof getBackgroundEntry>}
 */
export function lookupBackground(hp, pips) {
  return getBackgroundEntry(hp, pips);
}

/**
 * Get max ability after swap.
 * @param {{str:number|null, dex:number|null, wil:number|null}} totals
 */
export function getMaxAbility(totals) {
  const vals = [totals?.str, totals?.dex, totals?.wil].filter((n) => Number.isFinite(n));
  if (!vals.length) return null;
  return Math.max(...vals);
}

/**
 * Extra background rule:
 * - if max ability <= 9: gain one extra item (A or B) from an extra background roll
 * - if max ability <= 7: gain both extra items (A and B)
 */
export function getExtraBackgroundRule(maxAbility) {
  if (!Number.isFinite(maxAbility)) return { enabled: false, takeBoth: false };
  if (maxAbility <= 7) return { enabled: true, takeBoth: true };
  if (maxAbility <= 9) return { enabled: true, takeBoth: false };
  return { enabled: false, takeBoth: false };
}

export async function rollD6() {
  const r = new Roll("1d6");
  await r.evaluate({ allowInteractive: true });
  return r;
}

// d66 = (d6 * 10) + d6; keep as string like "41"
export async function rollD66() {
  const r = new Roll("1d6*10 + 1d6");
  await r.evaluate({ allowInteractive: true });
  // Normalize to 11..66
  const total = Number(r.total);
  const tens = Math.floor(total / 10);
  const ones = total % 10;
  const norm = `${Math.max(1, Math.min(6, tens))}${Math.max(1, Math.min(6, ones))}`;
  return { roll: r, value: norm };
}

export function pickFromD6(list, d6Value) {
  const idx = Math.max(1, Math.min(6, Number(d6Value))) - 1;
  return list[idx] ?? null;
}

/**
 * Roll all “details”:
 * - birthsign (d6)
 * - coat color (d6)
 * - coat pattern (d6)
 * - physical detail (d66)
 */
export async function rollDetails() {
  const birthRoll = await rollD6();
  const colorRoll = await rollD6();
  const patternRoll = await rollD6();
  const phys = await rollD66();

  const birth = pickFromD6(BIRTHSIGNS, birthRoll.total);
  const color = pickFromD6(COAT_COLORS, colorRoll.total);
  const pattern = pickFromD6(COAT_PATTERNS, patternRoll.total);
  const physicalKey = getPhysicalDetailKey(phys.value);

  return {
    rolls: { birthRoll, colorRoll, patternRoll, physicalRoll: phys.roll },
    values: {
      birthIndex: Number(birthRoll.total),
      colorIndex: Number(colorRoll.total),
      patternIndex: Number(patternRoll.total),
      physicalD66: phys.value
    },
    resolved: { birth, color, pattern, physicalKey }
  };
}

/**
 * Build the actor.system payload for Mausritter characters.
 * Schema comes from Mausritter system template.json. :contentReference[oaicite:1]{index=1}
 */
export function buildCharacterSystemData({ abilityTotals, hp, pips, backgroundText, birthsignText, coatText, lookText }) {
  return {
    health: { value: hp, min: 0, max: hp },
    pips: { value: pips },
    stats: {
      strength: { value: abilityTotals.str, max: abilityTotals.str, label: "Strength" },
      dexterity: { value: abilityTotals.dex, max: abilityTotals.dex, label: "Dexterity" },
      will: { value: abilityTotals.wil, max: abilityTotals.wil, label: "Will" }
    },
    description: {
      background: backgroundText ?? "",
      birthsign: birthsignText ?? "",
      coat: coatText ?? "",
      look: lookText ?? ""
    }
  };
}

/**
 * Roll mouse names:
 * - Birthname: 1d100
 * - Matriname (family): 1d20
 * Returns i18n keys for the rolled entries.
 */
export async function rollNameParts() {
  const birthRoll = new Roll("1d100");
  await birthRoll.evaluate({ allowInteractive: true });

  const familyRoll = new Roll("1d20");
  await familyRoll.evaluate({ allowInteractive: true });

  const birth = Number(birthRoll.total);
  const family = Number(familyRoll.total);

  return {
    rolls: { birthRoll, familyRoll },
    values: { birth, family },
    keys: {
      birthnameKey: getBirthnameKey(birth),
      matrinameKey: getMatrinameKey(family)
    }
  };
}