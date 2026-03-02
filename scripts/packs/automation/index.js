import { PackManager } from "../../framework/packs.js";
import { MODULE_ID } from "../../framework/paths.js";

/**
 * Automation Pack (experimental)
 * - Apply weapon damage from Mausritter chat cards to a single targeted token.
 *
 * Assumptions (Mausritter system v0.3.21):
 * - Damage cards contain: .roll-damagebox .value
 * - HP path: actor.system.health.value
 * - Stats paths: actor.system.stats.{strength|dexterity|will}.value
 */

/* -------------------------------------------- */
/* Rest UI + Wear automation (phase 1)          */
/* Insert BEFORE function isFeatureEnabled()    */
/* -------------------------------------------- */

/** @returns {boolean} */
function isRestUIEnabled() {
  return game.settings.get(MODULE_ID, "automation.rest.enabled") !== false;
}

/** @returns {boolean} */
function isWearEnabled() {
  return game.settings.get(MODULE_ID, "automation.wear.enabled") !== false;
}

/** @returns {boolean} */
function isWearSpellsEnabled() {
  return game.settings.get(MODULE_ID, "automation.wear.spells.enabled") !== false;
}

function _i18n(key, fallback) {
  try {
    if (game?.i18n?.has?.(key)) return game.i18n.localize(key);
  } catch (_e) {}
  return fallback ?? key;
}

function _notify(msg) {
  try {
    ui.notifications?.info(msg);
  } catch (_e) {}
}

/**
 * Evaluate a roll synchronously (Foundry v13).
 * @param {Roll} roll
 * @returns {Roll}
 */
function _evalSync(roll) {
  // v13: async removed; use evaluateSync
  return roll.evaluateSync();
}

/** @returns {number} */
function _rollD6Plus1() {
  const r = _evalSync(new Roll("1d6 + 1"));
  return Number(r.total) || 0;
}

/** @returns {number} */
function _rollD6() {
  const r = _evalSync(new Roll("1d6"));
  return Number(r.total) || 0;
}

/**
 * Post a small, readable chat log entry (GM-facing).
 * @param {Actor} actor
 * @param {string} title
 * @param {string[]} lines
 */
async function postAutomationLog(actor, title, lines) {
  const speaker = ChatMessage.getSpeaker({ actor });
  const content = `
    <div class="mrqol-log">
      <h3 style="margin:0 0 .25rem 0;">${title}</h3>
      <ul style="margin:.25rem 0 0 1.1rem; padding:0;">
        ${lines.map((l) => `<li>${l}</li>`).join("")}
      </ul>
    </div>
  `;

  await ChatMessage.create({
    speaker,
    content,
    whisper: game.user?.isGM ? [] : undefined
  });
}

/**
 * Add rest buttons to actor sheet header (GM only).
 * Hook: getActorSheetHeaderButtons
 * @param {ActorSheet} sheet
 * @param {Array} buttons
 */
function addRestButtons(sheet, buttons) {
  if (!isRestUIEnabled()) return;
  if (!game.user?.isGM) return;

  const actor = sheet?.actor;
  if (!actor) return;

  // Avoid duplicates if sheet re-renders
  if (buttons.some((b) => b?.class?.includes("mrqol-rest-"))) return;

  buttons.unshift(
    {
      label: _i18n("MRQOL.Rest.Button.Short", "Short Rest"),
      class: "mrqol-rest-short",
      icon: "fas fa-mug-hot",
      onclick: () => applyShortRest(actor)
    },
    {
      label: _i18n("MRQOL.Rest.Button.Long", "Long Rest"),
      class: "mrqol-rest-long",
      icon: "fas fa-campground",
      onclick: () => applyLongRest(actor)
    },
    {
      label: _i18n("MRQOL.Rest.Button.Full", "Full Rest"),
      class: "mrqol-rest-full",
      icon: "fas fa-bed",
      onclick: () => applyFullRest(actor)
    }
  );
}

/** @returns {{hpValue:number,hpMax:number}} */
function _readHP(actor) {
  const hpValue = Number(foundry.utils.getProperty(actor, "system.health.value")) || 0;
  const hpMax = Number(foundry.utils.getProperty(actor, "system.health.max")) || hpValue;
  return { hpValue, hpMax };
}

/** @returns {{str:number,dex:number,wil:number,strMax:number,dexMax:number,wilMax:number}} */
function _readStats(actor) {
  const str = Number(foundry.utils.getProperty(actor, "system.stats.strength.value")) || 0;
  const dex = Number(foundry.utils.getProperty(actor, "system.stats.dexterity.value")) || 0;
  const wil = Number(foundry.utils.getProperty(actor, "system.stats.will.value")) || 0;

  const strMax = Number(foundry.utils.getProperty(actor, "system.stats.strength.max")) || str;
  const dexMax = Number(foundry.utils.getProperty(actor, "system.stats.dexterity.max")) || dex;
  const wilMax = Number(foundry.utils.getProperty(actor, "system.stats.will.max")) || wil;

  return { str, dex, wil, strMax, dexMax, wilMax };
}

async function applyShortRest(actor) {
  const { hpValue, hpMax } = _readHP(actor);
  const heal = _rollD6Plus1();
  const newHP = Math.min(hpMax, hpValue + heal);

  await actor.update({ "system.health.value": newHP });

  await postAutomationLog(actor, _i18n("MRQOL.Rest.Chat.Short", "Short Rest"), [
    `${actor.name}: HP ${hpValue} → ${newHP} (+${newHP - hpValue})`
  ]);

  _notify(`${actor.name}: ${_i18n("MRQOL.Rest.Chat.Short", "Short Rest")}`);
}

async function applyLongRest(actor) {
  const { hpValue, hpMax } = _readHP(actor);
  const stats = _readStats(actor);

  // Long rest: restore all HP.
  // If HP already full, restore d6 to ONE attribute score (choose).
  if (hpValue < hpMax) {
    await actor.update({ "system.health.value": hpMax });
    await postAutomationLog(actor, _i18n("MRQOL.Rest.Chat.Long", "Long Rest"), [
      `${actor.name}: HP ${hpValue} → ${hpMax}`
    ]);
    _notify(`${actor.name}: ${_i18n("MRQOL.Rest.Chat.Long", "Long Rest")}`);
    return;
  }

  // HP already full -> pick stat to restore
  const pick = await new Promise((resolve) => {
    new Dialog({
      title: _i18n("MRQOL.Rest.Chat.Long", "Long Rest"),
      content: `<p>${actor.name}: HP is already full. Restore <b>1d6</b> to which attribute?</p>`,
      buttons: {
        str: { label: "STR", callback: () => resolve("strength") },
        dex: { label: "DEX", callback: () => resolve("dexterity") },
        wil: { label: "WIL", callback: () => resolve("will") }
      },
      default: "str",
      close: () => resolve(null)
    }).render(true);
  });

  if (!pick) return;

  const amt = _rollD6();
  const path = `system.stats.${pick}.value`;
  const before = Number(foundry.utils.getProperty(actor, path)) || 0;
  const maxPath = `system.stats.${pick}.max`;
  const max = Number(foundry.utils.getProperty(actor, maxPath)) || before;
  const after = Math.min(max, before + amt);

  await actor.update({ [path]: after });

  await postAutomationLog(actor, _i18n("MRQOL.Rest.Chat.Long", "Long Rest"), [
    `${actor.name}: HP already full (${hpMax})`,
    `${pick.toUpperCase()} ${before} → ${after} (+${after - before})`
  ]);

  _notify(`${actor.name}: ${_i18n("MRQOL.Rest.Chat.Long", "Long Rest")}`);
}

async function applyFullRest(actor) {
  const { hpValue, hpMax } = _readHP(actor);
  const { str, dex, wil, strMax, dexMax, wilMax } = _readStats(actor);

  const update = {
    "system.health.value": hpMax,
    "system.stats.strength.value": strMax,
    "system.stats.dexterity.value": dexMax,
    "system.stats.will.value": wilMax
  };

  await actor.update(update);

  await postAutomationLog(actor, _i18n("MRQOL.Rest.Chat.Full", "Full Rest"), [
    `${actor.name}: HP ${hpValue} → ${hpMax}`,
    `STR ${str} → ${strMax}`,
    `DEX ${dex} → ${dexMax}`,
    `WIL ${wil} → ${wilMax}`
  ]);

  _notify(`${actor.name}: ${_i18n("MRQOL.Rest.Chat.Full", "Full Rest")}`);
}

/* -------------------------------------------- */
/* Wear automation (combat end + spell cast)    */
/* -------------------------------------------- */

function _isEquipped(item) {
  // MRQOL flag from layout/overflow logic (if you already set it elsewhere)
  if (item?.getFlag?.(MODULE_ID, "equipped") === true) return true;

  // Layout flag: { zone: "worn" } is a good proxy for "equipped"
  const layout = item?.getFlag?.(MODULE_ID, "layout");
  if (layout?.zone === "worn") return true;

  // Optional system flag fallback
  const sysEq = foundry.utils.getProperty(item, "system.equipped");
  if (sysEq === true) return true;

  return false;
}

function _isAmmo(item) {
  // Mausritter often uses tags; be defensive
  const tags = foundry.utils.getProperty(item, "system.tags");
  const tagStr = Array.isArray(tags) ? tags.join(" ").toLowerCase() : String(tags ?? "").toLowerCase();
  if (tagStr.includes("ammunition")) return true;
  if (String(item?.name ?? "").toLowerCase().includes("arrow")) return true;
  if (String(item?.name ?? "").toLowerCase().includes("arrows")) return true;
  if (String(item?.name ?? "").toLowerCase().includes("stones")) return true;
  return false;
}

async function _markOneUsage(item) {
  const max = Number(foundry.utils.getProperty(item, "system.pips.max")) || 0;
  const val = Number(foundry.utils.getProperty(item, "system.pips.value")) || 0;
  if (!max) return false;
  if (val >= max) return false;
  await item.update({ "system.pips.value": val + 1 });
  return true;
}

/**
 * Combat wear, phase 1 heuristic:
 * - At combat end, roll 1d6 per candidate item; on 4-6 mark 1 usage.
 * - Candidates: weapon/armor (+ ammo optional)
 * - Optional: equipped-only for PCs
 * @param {Combat} combat
 */
async function applyCombatWear(combat) {
  if (!isWearEnabled()) return;

  const equippedOnly = game.settings.get(MODULE_ID, "automation.wear.combat.equippedOnly") !== false;
  const includeAmmo = game.settings.get(MODULE_ID, "automation.wear.combat.includeAmmo") !== false;
  const alwaysMarkSilvered = game.settings.get(MODULE_ID, "automation.wear.combat.alwaysMarkSilvered") !== false;

  /** @type {Map<string, Actor>} */
  const actors = new Map();
  for (const c of combat?.combatants ?? []) {
    const a = c?.actor;
    if (a?.uuid) actors.set(a.uuid, a);
  }
  if (!actors.size) return;

  for (const actor of actors.values()) {
    const items = actor.items ?? [];
    const candidates = items.filter((it) => {
      if (!it) return false;
      if (it.type === "weapon" || it.type === "armor") return true;
      if (includeAmmo && _isAmmo(it)) return true;
      return false;
    });

    const finalCandidates = candidates.filter((it) => {
      if (!equippedOnly) return true;
      // If actor is not a character, be permissive
      if (actor.type !== "character") return true;
      // Equipped-only for characters
      return _isEquipped(it);
    });

    if (!finalCandidates.length) continue;

    const lines = [];
    for (const it of finalCandidates) {
      // Silvered weapons: always mark 1 usage (RAW)
      if (alwaysMarkSilvered && it.type === "weapon" && String(it.name ?? "").toLowerCase().includes("silver")) {
        const did = await _markOneUsage(it);
        if (did) lines.push(`${it.name}: +1 usage (silvered)`);
        continue;
      }

      const roll = _rollD6();
      if (roll >= 4) {
        const did = await _markOneUsage(it);
        if (did) lines.push(`${it.name}: 1d6=${roll} → +1 usage`);
      } else {
        lines.push(`${it.name}: 1d6=${roll} → no wear`);
      }
    }

    if (lines.length) {
      await postAutomationLog(actor, _i18n("MRQOL.Wear.Chat.CombatEnd", "Wear after combat"), lines);
    }
  }
}

/**
 * Spell wear from a ChatMessage:
 * - No re-roll: uses existing message.rolls (if any).
 * - Marks one usage per die showing 4-6 (Mausritter spell casting rule).
 * - Best effort to find the spell item on the speaker actor.
 * @param {ChatMessage} message
 */
async function applySpellWearFromMessage(message) {
  if (!isWearEnabled()) return;
  if (!isWearSpellsEnabled()) return;

  const speakerActorId = message?.speaker?.actor;
  const actor = speakerActorId ? game.actors?.get(speakerActorId) : null;
  if (!actor) return;

  const rolls = message?.rolls ?? [];
  if (!Array.isArray(rolls) || !rolls.length) return;

  // Gather d6 results from any roll in the message
  const d6Results = [];
  for (const r of rolls) {
    try {
      const terms = r?.terms ?? [];
      for (const t of terms) {
        // DiceTerm: faces === 6 and has results[]
        if (t?.faces === 6 && Array.isArray(t?.results)) {
          for (const res of t.results) {
            const v = Number(res?.result);
            if (Number.isFinite(v)) d6Results.push(v);
          }
        }
      }
    } catch (_e) {}
  }
  if (!d6Results.length) return;

  // Heuristic: only treat as spell cast if the card mentions spell/tablet/casting OR actor has a spell whose name appears
  const html = String(message?.content ?? "");
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const looksLikeSpell = text.includes("spell") || text.includes("tablet") || text.includes("cast") || text.includes("hechizo") || text.includes("tablilla") || text.includes("lanza");

  // Try to find a spell item
  let spell = null;
  const spells = actor.items?.filter((i) => i?.type === "spell") ?? [];
  if (spells.length) {
    spell =
      spells.find((s) => text.includes(String(s.name ?? "").toLowerCase())) ??
      spells[0]; // fallback to first spell if it looks like spell cast
  }

  if (!looksLikeSpell || !spell) return;

  const marks = d6Results.filter((v) => v >= 4).length;
  if (marks <= 0) {
    await postAutomationLog(actor, _i18n("MRQOL.Wear.Chat.SpellCast", "Spell wear"), [
      `${spell.name}: no usage marked (rolled ${d6Results.join(", ")})`
    ]);
    return;
  }

  // Mark usage N times, capped by max
  const max = Number(foundry.utils.getProperty(spell, "system.pips.max")) || 0;
  const val = Number(foundry.utils.getProperty(spell, "system.pips.value")) || 0;
  if (!max) return;

  const next = Math.min(max, val + marks);
  if (next === val) return;

  await spell.update({ "system.pips.value": next });

  await postAutomationLog(actor, _i18n("MRQOL.Wear.Chat.SpellCast", "Spell wear"), [
    `${spell.name}: rolled ${d6Results.join(", ")} → +${next - val} usage (${val} → ${next})`
  ]);
}

/** @returns {boolean} */
function isFeatureEnabled() {
  return game.settings.get(MODULE_ID, "automation.damage.enabled") !== false;
}

/** @returns {boolean} */
function isAutoApplyEnabled() {
  return game.settings.get(MODULE_ID, "automation.damage.autoApply") !== false;
}

/** @returns {boolean} */
function isButtonEnabled() {
  return game.settings.get(MODULE_ID, "automation.damage.showButton") !== false;
}

/**
 * Extract damage total from a Mausritter damage chat card.
 * @param {ChatMessage} message
 * @returns {number|null}
 */
function extractDamageTotal(message) {
  const html = String(message?.content ?? "");
  if (!html.includes("roll-damagebox")) return null;

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el = doc.querySelector(".roll-damagebox .value");
    const raw = el?.textContent?.trim() ?? "";
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  } catch (_err) {
    // Fallback: regex
    const m = html.match(/roll-damagebox[\s\S]*?<div class=\"value\">\s*(\d+)\s*<\/div>/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
}

/**
 * Determine which stat receives overflow damage once HP reaches 0.
 * Defaults to STR, but supports common Mausritter wording in the card description.
 * @param {ChatMessage} message
 * @returns {"strength"|"dexterity"|"will"}
 */
function extractOverflowStat(message) {
  const html = String(message?.content ?? "");
  // Strip tags for easier matching
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

  // Common wording: "Damages DEX instead of STR" / "Damages WILL instead of STR"
  if (text.includes("DAMAGES DEX") && text.includes("INSTEAD OF STR")) return "dexterity";
  if (text.includes("DAMAGES WILL") && text.includes("INSTEAD OF STR")) return "will";

  return "strength";
}

/**
 * Get equipped armor value for the actor.
 * - character: prefer MRQOL equipped flag OR layout zone "worn"
 * - others (hireling/creature): treat any armor as effectively equipped (pick best)
 * @param {Actor} actor
 * @returns {number}
 */
function getEquippedArmorValue(actor) {
  if (!actor) return 0;

  const armors = actor.items?.filter((i) => i?.type === "armor") ?? [];
  if (!armors.length) return 0;

  const armorValueOf = (it) => {
    const v = Number(foundry.utils.getProperty(it, "system.armor.value"));
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  };

  // Non-characters: everything counts as equipped -> take the best armor value
  if (actor.type !== "character") {
    return armors.reduce((best, it) => Math.max(best, armorValueOf(it)), 0);
  }

  // Characters: only equipped armor counts
  const isEquipped = (it) => {
    // MRQOL derived flag (set when zone is "worn")
    if (it.getFlag(MODULE_ID, "equipped") === true) return true;

    // Layout zone worn (more reliable than item.system flags)
    const layout = it.getFlag(MODULE_ID, "layout");
    if (layout?.zone === "worn") return true;

    // Fallback if system has an equipped-like flag (safe optional)
    const sysEq = foundry.utils.getProperty(it, "system.equipped");
    if (sysEq === true) return true;

    return false;
  };

  const equippedArmors = armors.filter(isEquipped);
  if (!equippedArmors.length) return 0;

  // If multiple equipped armors exist, take the best
  return equippedArmors.reduce((best, it) => Math.max(best, armorValueOf(it)), 0);
}

/**
 * Compute damage after armor.
 * @param {number} rawDamage
 * @param {number} armorValue
 * @returns {{finalDamage:number, armorSubtracted:number}}
 */
function computeArmorReduction(rawDamage, armorValue) {
  const d = Math.max(0, Number(rawDamage) || 0);
  const a = Math.max(0, Number(armorValue) || 0);
  const armorSubtracted = Math.min(d, a);
  return { finalDamage: d - armorSubtracted, armorSubtracted };
}

/**
 * Get current HP and a stat value from an actor.
 * @param {Actor} actor
 * @param {"strength"|"dexterity"|"will"} stat
 */
function readHpAndStat(actor, stat) {
  const hpPath = "system.health.value";
  const statPath = `system.stats.${stat}.value`;
  const hp = Number(foundry.utils.getProperty(actor, hpPath));
  const sv = Number(foundry.utils.getProperty(actor, statPath));
  return {
    hpPath,
    statPath,
    hp: Number.isFinite(hp) ? hp : 0,
    stat: Number.isFinite(sv) ? sv : 0
  };
}

/**
 * Build an undo payload.
 * @param {Token} target
 * @param {"strength"|"dexterity"|"will"} overflowStat
 * @param {{hp:number, stat:number}} before
 * @param {{hpDamage:number, attrDamage:number}} breakdown
 * @param {number} damage
 */
function buildUndoPayload(target, overflowStat, before, breakdown, damage) {
  return {
    v: 1,
    used: false,
    actorUuid: target.actor?.uuid ?? null,
    tokenUuid: target.document?.uuid ?? null,
    overflowStat,
    damage,
    hpBefore: before.hp,
    attrBefore: before.stat,
    hpDamage: breakdown.hpDamage,
    attrDamage: breakdown.attrDamage,
    at: Date.now()
  };
}

/**
 * Ledger of damage applications per chat message.
 * Stored on the damage ChatMessage to prevent re-applying the same damage to the same target.
 *
 * Shape:
 * {
 *   v: 1,
 *   applied: {
 *     [actorUuid]: {
 *       used: boolean,
 *       ...payload (same fields as buildUndoPayload)
 *     }
 *   }
 * }
 * @param {ChatMessage} message
 */

// Fallback (client-only) ledger in case ChatMessage flags can't be persisted.
// Key: `${message.id}:${actorUuid}`
// Value: { ...payload, used:boolean }
const _damageAppliedMemory = new Map();

/**
 * @param {ChatMessage} message
 * @param {Token} target
 */
function _memKey(message, target) {
  const actorUuid = target?.actor?.uuid;
  return actorUuid ? `${message.id}:${actorUuid}` : null;
}

/**
 * @param {ChatMessage} message
 * @param {Token} target
 * @returns {object|null}
 */
function _getMemoryEntry(message, target) {
  const k = _memKey(message, target);
  if (!k) return null;
  const v = _damageAppliedMemory.get(k);
  return v && typeof v === "object" ? v : null;
}

/**
 * @param {ChatMessage} message
 * @param {Token} target
 */
function _isAppliedInMemory(message, target) {
  const entry = _getMemoryEntry(message, target);
  return !!(entry && entry.used === false);
}

/**
 * @param {ChatMessage} message
 * @param {Token} target
 * @param {object|null} payloadOrNull
 */
function _setMemoryEntry(message, target, payloadOrNull) {
  const k = _memKey(message, target);
  if (!k) return;
  if (!payloadOrNull) _damageAppliedMemory.delete(k);
  else _damageAppliedMemory.set(k, payloadOrNull);
}

function getDamageLedger(message) {
  const raw = message.getFlag(MODULE_ID, "automation.damageLedger");
  if (raw && typeof raw === "object" && raw.v === 1 && raw.applied && typeof raw.applied === "object") return raw;
  return { v: 1, applied: {} };
}

/**
 * @param {ChatMessage} message
 * @param {object} ledger
 */
async function setDamageLedger(message, ledger) {
  await message.setFlag(MODULE_ID, "automation.damageLedger", ledger);
}

/**
 * @param {ChatMessage} message
 * @param {Token} target
 * @returns {object|null}
 */
function getLedgerEntryForTarget(message, target) {
  const actorUuid = target?.actor?.uuid;
  if (!actorUuid) return null;
  const ledger = getDamageLedger(message);
  return ledger.applied?.[actorUuid] ?? _getMemoryEntry(message, target) ?? null;
}

/**
 * @param {ChatMessage} message
 * @param {Token} target
 * @returns {boolean}
 */
function isDamageAppliedToTarget(message, target) {
  const entry = getLedgerEntryForTarget(message, target);
  return !!(entry && entry.used === false);
}

/**
 * Update Apply/Undo button states for a rendered chat message.
 * @param {ChatMessage} message
 * @param {HTMLElement} root
 */
function refreshDamageButtons(message, root) {
  if (!(root instanceof HTMLElement)) return;

  const btnRow = root.querySelector(".mrqol-damage-actions");
  if (!(btnRow instanceof HTMLElement)) return;

  const applyBtn = btnRow.querySelector("button.mrqol-apply-damage");
  const undoBtn = btnRow.querySelector("button.mrqol-undo-damage");

  const currentTarget = getSingleTarget();
  const entry = currentTarget ? getLedgerEntryForTarget(message, currentTarget) : null;
  const alreadyApplied =
    currentTarget ? (isDamageAppliedToTarget(message, currentTarget) || _isAppliedInMemory(message, currentTarget)) : false;

  // Apply: visually disable if already applied for the current target (optional but helpful)
  if (applyBtn instanceof HTMLButtonElement) {
    applyBtn.disabled = !!alreadyApplied;
  }

  // Undo: always visible, enabled only if there is an entry and it's not used
  if (undoBtn instanceof HTMLButtonElement) {
    undoBtn.hidden = false;
    undoBtn.disabled = !entry || !!entry.used;
  }
}

async function applyDamageToToken(token, damage, overflowStat) {
  const actor = token?.actor;
  if (!actor) throw new Error("No actor on targeted token");

  const hpPath = "system.health.value";
  const statPath = `system.stats.${overflowStat}.value`;

  const hp = Number(foundry.utils.getProperty(actor, hpPath));
  const stat = Number(foundry.utils.getProperty(actor, statPath));

  const safeHp = Number.isFinite(hp) ? hp : 0;
  const safeStat = Number.isFinite(stat) ? stat : 0;
  const safeDamage = Math.max(0, Number(damage) || 0);

  const hpDamage = Math.min(safeHp, safeDamage);
  const attrDamage = Math.max(0, safeDamage - safeHp);

  const hpAfter = Math.max(0, safeHp - safeDamage);
  const attrAfter = Math.max(0, safeStat - attrDamage);

  /** @type {Record<string, number>} */
  const update = {
    [hpPath]: hpAfter
  };
  if (attrDamage > 0) update[statPath] = attrAfter;

  await actor.update(update);

  return { hpDamage, attrDamage, overflowStat, hpAfter, attrAfter };
}

/**
 * Return the single targeted token if exactly one is targeted.
 * @returns {Token|null}
 */
function getSingleTarget() {
  const targets = Array.from(game.user?.targets ?? []);
  if (targets.length !== 1) return null;
  return targets[0] ?? null;
}

/**
 * Warn in a consistent way.
 * @param {string} key
 */
function warn(key) {
  const msg = game.i18n?.has(key) ? game.i18n.localize(key) : key;
  ui.notifications?.warn(msg);
}

/**
 * Info notification.
 * @param {string} key
 */
function info(key) {
  const msg = game.i18n?.has(key) ? game.i18n.localize(key) : key;
  ui.notifications?.info(msg);
}

/**
 * Map overflow stat to short label STR/DEX/WIL.
 * @param {"strength"|"dexterity"|"will"} stat
 */
function statShortLabel(stat) {
  switch (stat) {
    case "dexterity":
      return game.i18n.localize("MRQOL.Automation.Stat.DEX");
    case "will":
      return game.i18n.localize("MRQOL.Automation.Stat.WIL");
    default:
      return game.i18n.localize("MRQOL.Automation.Stat.STR");
  }
}

/**
 * Post a chat message describing applied damage.
 * @param {Token} target
 * @param {{ hpDamage:number, attrDamage:number, overflowStat:"strength"|"dexterity"|"will" }} breakdown
 */
async function postDamageAppliedMessage(target, breakdown, armorSubtracted = 0) {
  const targetName = target?.name ?? game.i18n.localize("MRQOL.Automation.Damage.UnknownTarget");
  const hpDamage = Number(breakdown?.hpDamage ?? 0) || 0;
  const attrDamage = Number(breakdown?.attrDamage ?? 0) || 0;
  const stat = statShortLabel(breakdown?.overflowStat ?? "strength");
  const armor = Number(armorSubtracted) || 0;
  const armorText = armor > 0
    ? game.i18n.format("MRQOL.Automation.Damage.ArmorSubtracted", { armor })
    : "";

  // If no overflow, omit attribute part for cleaner UX
  const contentKey =
    attrDamage > 0
      ? "MRQOL.Automation.Damage.ChatAppliedOverflow"
      : "MRQOL.Automation.Damage.ChatAppliedHpOnly";

let content = game.i18n.format(contentKey, {
  target: targetName,
  hp: hpDamage,
  attr: attrDamage,
  stat
});

if (armorText) {
  // Append armor note inside paragraph
  content = content.replace("</p>", ` <em>(${armorText})</em></p>`);
}

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ alias: game.user?.name ?? "MRQOL" })
  });
}

/**
 * Find first free Pack cell (1..6) based on Core layout flags.
 * If not found, returns 1.
 * @param {Actor} actor
 * @returns {number}
 */
/* function findFirstFreePackCell(actor) {
  const used = new Set();
  for (const it of actor.items) {
    const layout = it.getFlag(MODULE_ID, "layout");
    const cells = layout?.cells;
    if (!Array.isArray(cells)) continue;
    for (const cid of cells) {
      const s = String(cid);
      if (!s.startsWith("pack:")) continue;
      const n = Number(s.split(":")[1]);
      if (Number.isFinite(n)) used.add(n);
    }
  }
  for (let i = 1; i <= 6; i++) if (!used.has(i)) return i;
  return 1;
} */

/**
 * Pick Pack cell:
 * - first free (1..6)
 * - else least stacked (min count), tie -> lowest index
 * @param {Actor} actor
 * @returns {number}
 */
function pickPackCellFirstFreeElseLeastStack(actor) {
  const counts = new Map();
  for (let i = 1; i <= 6; i++) counts.set(i, 0);

  for (const it of actor.items) {
    const layout = it.getFlag(MODULE_ID, "layout");
    const cells = layout?.cells;
    if (!Array.isArray(cells)) continue;

    for (const cid of cells) {
      const s = String(cid);
      if (!s.startsWith("pack:")) continue;
      const n = Number(s.split(":")[1]);
      if (!Number.isFinite(n) || n < 1 || n > 6) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }

  // 1) first free
  for (let i = 1; i <= 6; i++) {
    if ((counts.get(i) ?? 0) === 0) return i;
  }

  // 2) least stacked
  let bestCell = 1;
  let bestCount = counts.get(1) ?? 0;
  for (let i = 2; i <= 6; i++) {
    const c = counts.get(i) ?? 0;
    if (c < bestCount) {
      bestCount = c;
      bestCell = i;
    }
  }
  return bestCell;
}

/**
 * Try to obtain an "Injured" condition item template from world items or compendiums.
 * Falls back to a minimal condition item.
 * @returns {Promise<object>} plain item data for embedded creation
 */
async function getInjuredItemTemplate() {
  const candidates = ["Injured", "Herido", "Herida", "Lesionado", "Lesionada"];

  // 1) World items: prefer type === "condition"
  const worldHits = [];
  for (const name of candidates) {
    for (const it of game.items ?? []) {
      if (it?.name !== name) continue;
      worldHits.push(it);
    }
  }
  const worldBest =
    worldHits.find((i) => i.type === "condition") ?? worldHits[0] ?? null;

  if (worldBest) {
    const data = worldBest.toObject();
    delete data._id;
    return data;
  }

  // 2) Compendiums: prefer type === "condition"
  /** @type {Array<{pack:any, _id:string, name:string, type?:string}>} */
  const packHits = [];
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    try {
      const index = await pack.getIndex({ fields: ["name", "type"] });
      for (const e of index) {
        if (!candidates.includes(e.name)) continue;
        packHits.push({ pack, _id: e._id, name: e.name, type: e.type });
      }
    } catch (_e) {
      // ignore
    }
  }

  const best =
    packHits.find((h) => h.type === "condition") ?? packHits[0] ?? null;

  if (best) {
    const doc = await best.pack.getDocument(best._id);
    if (doc) {
      const data = doc.toObject();
      delete data._id;
      return data;
    }
  }

  // 3) Fallback (minimal)
  return {
    name: "Injured",
    type: "condition",
    system: {}
  };
}

/**
 * Ensure Unconscious status effect exists on actor.
 * Uses ActiveEffect with statuses:["unconscious"] to be system-agnostic.
 * @param {Actor} actor
 */
/* async function ensureUnconsciousEffect(actor) {
  const already = actor.effects?.some((e) => {
    const sts = e.statuses ? Array.from(e.statuses) : [];
    return sts.includes("unconscious");
  });
  if (already) return;

  const cfg = Array.isArray(CONFIG.statusEffects)
    ? CONFIG.statusEffects.find((s) => s.id === "unconscious")
    : null;

  const name = cfg?.name ?? game.i18n.localize("MRQOL.Automation.Unconscious.Name");
  const icon = cfg?.icon ?? "icons/svg/unconscious.svg";

  await actor.createEmbeddedDocuments("ActiveEffect", [
    {
      name,
      icon,
      statuses: ["unconscious"],
      disabled: false
    }
  ]);
} */

/**
 * Try to find a status effect config entry by id or by name-key (e.g. EFFECT.StatusDead).
 * @param {string[]} ids
 * @param {string[]} nameKeys
 */
function findStatusConfig(ids, nameKeys) {
  if (!Array.isArray(CONFIG.statusEffects)) return null;

  for (const id of ids) {
    const hit = CONFIG.statusEffects.find((s) => s?.id === id);
    if (hit) return hit;
  }

  for (const k of nameKeys) {
    const hit = CONFIG.statusEffects.find((s) => {
      const n = s?.name;
      if (typeof n === "string") return n === k;
      if (n && typeof n === "object") return n?.label === k || n?.value === k || n?.name === k;
      return false;
    });
    if (hit) return hit;
  }

  return null;
}

/**
 * Ensure a status effect exists on actor via ActiveEffect.statuses.
 * @param {Actor} actor
 * @param {string} statusId
 * @param {string} fallbackNameKey i18n key for effect name
 */
async function ensureStatusEffect(actor, statusId, fallbackNameKey) {
  if (!actor || !statusId) return;

  const already = actor.effects?.some((e) => {
    const sts = e.statuses ? Array.from(e.statuses) : [];
    return sts.includes(statusId);
  });
  if (already) return;

  const cfg = findStatusConfig([statusId], []);

  // cfg.name can be a string or an object depending on system; normalize to string
  let cfgName = cfg?.name;
  if (cfgName && typeof cfgName === "object") {
    // try common fields
    cfgName = cfgName.label ?? cfgName.value ?? cfgName.name;
  }
  const name =
    (typeof cfgName === "string" && cfgName.trim()) ||
    game.i18n.localize(fallbackNameKey);

  const icon = (typeof cfg?.img === "string" && cfg.img) || "icons/svg/aura.svg";

  await actor.createEmbeddedDocuments("ActiveEffect", [
    {
      name,
      icon,
      statuses: [statusId],
      disabled: false
    }
  ]);
}


/**
 * Roll a STR save for the given actor and apply Injured + Unconscious on failure.
 * Guarded so it only runs once per damage message.
 * @param {ChatMessage} message
 * @param {Token} target
 * @param {number} strValue
 */
 
 async function ensureInjuredCondition(actor) {
  const candidates = ["Injured", "Herido", "Herida", "Lesionado", "Lesionada"];

  const already = actor.items?.some((it) => it.type === "condition" && candidates.includes(it.name));
  if (already) return;

  const template = await getInjuredItemTemplate();

  // IMPORTANT: no layout flag -> Core will auto-place + snap + rebalance
  template.flags = template.flags ?? {};
  if (template.flags[MODULE_ID]?.layout) delete template.flags[MODULE_ID].layout;
  if (template.flags["mausritter-qol"]?.layout) delete template.flags["mausritter-qol"].layout;

  await actor.createEmbeddedDocuments("Item", [template]);
}

async function applyDead(actor) {
  // Try common dead IDs; fall back to "dead"
  // If your HUD uses a different id, add it here once you know it.
  const cfg = findStatusConfig(["dead", "death"], ["EFFECT.StatusDead"]);
  const deadId = cfg?.id ?? "dead";
  await ensureStatusEffect(actor, deadId, "MRQOL.Automation.Dead.Name");
}

async function applyHouseRuleStrZero(actor) {
  // Unconscious (your world likely has "unconscious"; if it’s different, replace with the HUD id)
  await ensureStatusEffect(actor, "unconscious", "MRQOL.Automation.Unconscious.Name");
  await ensureInjuredCondition(actor);
}
 
async function resolveStrInjurySave(message, target, strValue) {
  // guard per message (avoid double-processing on re-clicks / rerenders)
  const already = message.getFlag(MODULE_ID, "automation.strInjuryProcessed");
  if (already) return;

  await message.setFlag(MODULE_ID, "automation.strInjuryProcessed", true);

  const roll = await (new Roll("1d20")).evaluateSync();
  const total = roll.total ?? 0;
  const success = total <= (Number(strValue) || 0);

  // Post save result to chat
  const content = game.i18n.format(
    success ? "MRQOL.Automation.Save.ChatSuccess" : "MRQOL.Automation.Save.ChatFailure",
    {
      target: target.name ?? game.i18n.localize("MRQOL.Automation.Damage.UnknownTarget"),
      roll: total,
      targetValue: Number(strValue) || 0
    }
  );

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ alias: game.user?.name ?? "MRQOL" })
  });

  await message.setFlag(MODULE_ID, "automation.strInjurySave", {
    v: 1,
    actorUuid: target.actor?.uuid ?? null,
    tokenUuid: target.document?.uuid ?? null,
    roll: total,
    targetValue: Number(strValue) || 0,
    success
  });

  if (success) return;
  
  // RAW override: if STR is already 0 (or less), RAW says Dead and that should override injury/unconscious.
// House rule (if enabled + in scope) keeps unconscious+injured instead.
const currentStr = Number(foundry.utils.getProperty(target.actor, "system.stats.strength.value")) || 0;
const houseApplies = isHouseRuleStrZeroEnabled() && actorMatchesHouseRuleScope(target.actor);

if (currentStr <= 0 && !houseApplies) {
  await applyDead(target.actor);
  return;
}

// Failure: add Injured and Unconscious effect
const actor = target.actor;
const template = await getInjuredItemTemplate();

// IMPORTANT: remove any existing layout flag so Core can auto-place + snap + rebalance
template.flags = template.flags ?? {};
if (template.flags[MODULE_ID]?.layout) delete template.flags[MODULE_ID].layout;
if (template.flags["mausritter-qol"]?.layout) delete template.flags["mausritter-qol"].layout;

// Create item (Core will move it to Pack automatically because it has no layout)
await actor.createEmbeddedDocuments("Item", [template]);

// Apply Unconscious
await ensureStatusEffect(actor, "unconscious", "MRQOL.Automation.Unconscious.Name");

await ChatMessage.create({
  content: game.i18n.format("MRQOL.Automation.Injury.Applied", {
    target: target.name ?? game.i18n.localize("MRQOL.Automation.Damage.UnknownTarget")
  }),
  speaker: ChatMessage.getSpeaker({ alias: game.user?.name ?? "MRQOL" })
});
}

/**
 * Attempt to apply damage from a chat message.
 * @param {ChatMessage} message
 * @returns {Promise<boolean>} true if applied
 */
async function tryApplyDamageFromMessage(message) {
  const damage = extractDamageTotal(message);
  if (!damage || damage <= 0) return false;

  const target = getSingleTarget();
  if (!target) {
    warn("MRQOL.Automation.Damage.TargetOne");
    return false;
  }

  // Prevent re-applying the same message damage to the same target unless it was undone.
  // Use BOTH persisted ledger + in-memory fallback (for cases where message flags can't be written).
  if (isDamageAppliedToTarget(message, target) || _isAppliedInMemory(message, target)) {
    warn("MRQOL.Automation.Damage.AlreadyApplied");
    return false;
  }

const overflowStat = extractOverflowStat(message);

// Armor reduction (from equipped armor item)
const armorValue = getEquippedArmorValue(target.actor);
const { finalDamage, armorSubtracted } = computeArmorReduction(damage, armorValue);

// Read "before" snapshot for undo
const before = readHpAndStat(target.actor, overflowStat);

// Apply (use reduced damage)
const breakdown = await applyDamageToToken(target, finalDamage, overflowStat);

  // Store undo + applied ledger on the original damage message (per target)
  try {
    const payload = buildUndoPayload(
      target,
      overflowStat,
      { hp: before.hp, stat: before.stat },
      { hpDamage: breakdown.hpDamage, attrDamage: breakdown.attrDamage },
      damage
    );

    const ledger = getDamageLedger(message);
    const actorUuid = target.actor?.uuid;
    if (actorUuid) {
      ledger.applied[actorUuid] = { ...payload, used: false };
      await setDamageLedger(message, ledger);
    }

    // Always set local fallback memory once damage is applied (even if setFlag fails).
    _setMemoryEntry(message, target, { ...payload, used: false });
  } catch (err) {
    // Non-fatal: damage already applied
    console.warn("MRQOL | Failed to set damage ledger", err);
  }

  info("MRQOL.Automation.Damage.Applied");
  await postDamageAppliedMessage(target, breakdown, armorSubtracted);

  // STR injury save on STR damage (overflow to STR)
  if (breakdown.overflowStat === "strength" && (breakdown.attrDamage ?? 0) > 0) {
    const strValue =
      Number(foundry.utils.getProperty(target.actor, "system.stats.strength.value")) || 0;
    resolveStrInjurySave(message, target, strValue).catch((err) => {
      console.error("MRQOL | STR injury save failed", err);
    });
  }

  return true;
}

async function tryUndoDamageFromMessage(message) {
  const target = getSingleTarget();
  if (!target) {
    warn("MRQOL.Automation.Damage.TargetOne");
    return false;
  }

  const actorUuid = target.actor?.uuid ?? null;
  const tokenUuid = target.document?.uuid ?? null;
  if (!actorUuid) {
    warn("MRQOL.Automation.Undo.NotAvailable");
    return false;
  }

  const ledger = getDamageLedger(message);
  const data = ledger.applied?.[actorUuid] ?? _getMemoryEntry(message, target) ?? null;

  if (!data) {
    warn("MRQOL.Automation.Undo.NotAvailable");
    return false;
  }
  if (data.used) {
    warn("MRQOL.Automation.Undo.AlreadyUsed");
    return false;
  }

  // Safety: ensure undo applies to the same token/actor
  if ((data.tokenUuid && tokenUuid && data.tokenUuid !== tokenUuid) || (data.actorUuid && data.actorUuid !== actorUuid)) {
    warn("MRQOL.Automation.Undo.WrongTarget");
    return false;
  }

  const hpPath = "system.health.value";
  const statPath = `system.stats.${data.overflowStat}.value`;

  /** @type {Record<string, number>} */
  const update = {
    [hpPath]: Number(data.hpBefore) ?? 0,
    [statPath]: Number(data.attrBefore) ?? 0
  };

  await target.actor.update(update);

  // Mark used so Apply can be done again later
  ledger.applied[actorUuid] = { ...data, used: true };
  await setDamageLedger(message, ledger);
  _setMemoryEntry(message, target, { ...data, used: true });

// Allow re-apply after undo: already handled by marking the memory entry used=true above.
// (No extra action needed.)

  info("MRQOL.Automation.Undo.Done");
  await ChatMessage.create({
    content: game.i18n.format("MRQOL.Automation.Undo.Chat", {
      target: target.name ?? game.i18n.localize("MRQOL.Automation.Damage.UnknownTarget"),
      stat: statShortLabel(data.overflowStat)
    }),
    speaker: ChatMessage.getSpeaker({ alias: game.user?.name ?? "MRQOL" })
  });

  return true;
}

function onRenderChatMessage(message, html) {
  if (!isFeatureEnabled()) return;
  if (!isButtonEnabled()) return;

  const damage = extractDamageTotal(message);
  if (!damage || damage <= 0) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!(root instanceof HTMLElement)) return;

  // Insert buttons at the bottom of the Mausritter card
  const container =
    root.querySelector(".message-content .mausritter") ?? root.querySelector(".message-content");
  if (!container) return;

  // Button row (Apply / Undo) - single line
  let btnRow = container.querySelector(".mrqol-damage-actions");
  if (!btnRow) {
    btnRow = document.createElement("div");
    btnRow.className = "mrqol-damage-actions";
    btnRow.style.display = "flex";
    btnRow.style.flexWrap = "wrap";
    btnRow.style.gap = "6px";
    btnRow.style.marginTop = "6px";
    container.appendChild(btnRow);
  }

  // Apply button (no duplicates)
  if (!btnRow.querySelector("button.mrqol-apply-damage")) {
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "mrqol-apply-damage";
    applyBtn.innerHTML = `<i class="fa-solid fa-droplet"></i> ${game.i18n.localize(
      "MRQOL.Automation.Damage.Apply"
    )}`;
    applyBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        await tryApplyDamageFromMessage(message);
        refreshDamageButtons(message, root);
      } catch (err) {
        console.error("MRQOL | Failed to apply damage", err);
        warn("MRQOL.Automation.Damage.Failed");
      }
    });

    btnRow.appendChild(applyBtn);
  }

// Determine current target state for button enable/disable
const currentTarget = getSingleTarget();
const entry = currentTarget ? getLedgerEntryForTarget(message, currentTarget) : null;
const alreadyApplied = currentTarget ? isDamageAppliedToTarget(message, currentTarget) : false;

// Don't hard-disable Apply based on current target here, because target selection doesn't re-render chat messages.
// The click handler enforces the real safety check (ledger + memory).

// Ensure Undo button exists (but toggle visibility/disabled based on selected target)
let undoBtnEl = btnRow.querySelector("button.mrqol-undo-damage");
if (!undoBtnEl) {
  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "mrqol-undo-damage";
  undoBtn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${game.i18n.localize(
    "MRQOL.Automation.Undo.Button"
  )}`;
  undoBtn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      await tryUndoDamageFromMessage(message);
      refreshDamageButtons(message, root);
    } catch (err) {
      console.error("MRQOL | Failed to undo damage", err);
      warn("MRQOL.Automation.Damage.Failed");
    }
  });
  btnRow.appendChild(undoBtn);
  undoBtnEl = undoBtn;
}

// Undo should always be visible (target selection doesn't re-render chat messages).
// We only enable it when the currently selected target has an applicable ledger entry.
if (undoBtnEl instanceof HTMLButtonElement) {
  undoBtnEl.hidden = false;
  undoBtnEl.disabled = !entry || !!entry.used;
}
refreshDamageButtons(message, root);
}

function refreshAllDamageButtons() {
  // Iterate rendered chat messages that have our button row
  const nodes = document.querySelectorAll(".chat-message .mrqol-damage-actions");
  for (const row of nodes) {
    const msgEl = row.closest(".chat-message");
    const msgId = msgEl?.dataset?.messageId;
    if (!msgId) continue;
    const message = game.messages?.get(msgId);
    if (!message) continue;
    // root element for this message
    refreshDamageButtons(message, msgEl);
  }
}

function onCreateChatMessage(message) {
  if (!isFeatureEnabled()) return;

  // Auto-apply weapon damage
  if (isAutoApplyEnabled()) {
    const target = getSingleTarget();
    if (target) {
      tryApplyDamageFromMessage(message).catch((err) => {
        console.error("MRQOL | Auto-apply damage failed", err);
        warn("MRQOL.Automation.Damage.Failed");
      });
    }
  }

  // Wear (spells) - best effort, no re-roll
  applySpellWearFromMessage(message).catch((err) =>
    console.error("MRQOL | Spell wear failed", err)
  );
}

function isHouseRuleStrZeroEnabled() {
  return game.settings.get(MODULE_ID, "automation.strZero.houseRule.enabled") === true;
}

function getHouseRuleStrZeroScope() {
  return game.settings.get(MODULE_ID, "automation.strZero.houseRule.scope") || "characters";
}

/**
 * @param {Actor} actor
 */
function actorMatchesHouseRuleScope(actor) {
  const t = actor?.type;
  const scope = getHouseRuleStrZeroScope();

  if (scope === "characters") return t === "character";
  if (scope === "charactersHirelings") return t === "character" || t === "hireling";
  if (scope === "allCreatures") return t === "character" || t === "hireling" || t === "creature";
  return t === "character";
}

function onUpdateActor(actor, changes) {
  if (!isFeatureEnabled()) return;

  const dexChanged = foundry.utils.hasProperty(changes, "system.stats.dexterity.value");
  const wilChanged = foundry.utils.hasProperty(changes, "system.stats.will.value");
  const strChanged = foundry.utils.hasProperty(changes, "system.stats.strength.value");
  if (!dexChanged && !wilChanged && !strChanged) return;

  const dex = Number(foundry.utils.getProperty(actor, "system.stats.dexterity.value")) || 0;
  const wil = Number(foundry.utils.getProperty(actor, "system.stats.will.value")) || 0;
  const str = Number(foundry.utils.getProperty(actor, "system.stats.strength.value")) || 0;

  // DEX 0 => Paralyzed
  if (dex <= 0) {
    ensureStatusEffect(actor, "paralysis", "MRQOL.Automation.Paralyzed.Name").catch((err) =>
      console.error("MRQOL | Failed to apply Paralyzed", err)
    );
  }

  // WIL 0 => Stunned
  if (wil <= 0) {
    ensureStatusEffect(actor, "stun", "MRQOL.Automation.Stunned.Name").catch((err) =>
      console.error("MRQOL | Failed to apply Stunned", err)
    );
  }

  // STR 0 => RAW Dead (default) OR house-rule Unconscious + Injured
  if (str <= 0) {
    if (isHouseRuleStrZeroEnabled() && actorMatchesHouseRuleScope(actor)) {
      applyHouseRuleStrZero(actor).catch((err) =>
        console.error("MRQOL | Failed to apply house rule STR 0", err)
      );
    } else {
      applyDead(actor).catch((err) => console.error("MRQOL | Failed to apply Dead", err));
    }
  }
}

export const AutomationPack = {
  id: "automation",
  label: "Automation Pack (experimental)",
  description: "Experimental automations (opt-in).",
  defaultEnabled: false,
  init() {
    if (!isFeatureEnabled()) return;

    Hooks.on("renderChatMessageHTML", onRenderChatMessage);
    Hooks.on("createChatMessage", onCreateChatMessage);
	  Hooks.on("updateActor", onUpdateActor);
    // Rest UI buttons (GM)
    Hooks.on("getActorSheetHeaderButtons", addRestButtons);

    // Wear at end of combat
    Hooks.on("deleteCombat", (combat) => applyCombatWear(combat).catch(console.error));
    Hooks.on("updateCombat", (combat, change) => {
      if (change?.active === false) applyCombatWear(combat).catch(console.error);
    });
    Hooks.on("targetToken", refreshAllDamageButtons);
  },
  ready() {}
};

PackManager.register(AutomationPack);