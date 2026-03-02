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
  return ledger.applied?.[actorUuid] ?? null;
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
}

/**
 * Apply damage to a single token's actor:
 * - subtract from HP
 * - overflow goes to chosen stat (default STR)
 * @param {Token} token
 * @param {number} damage
 * @param {"strength"|"dexterity"|"will"} overflowStat
 * @returns {Promise<{ hpDamage:number, attrDamage:number, overflowStat:"strength"|"dexterity"|"will", hpAfter:number, attrAfter:number }>}
 */
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
async function postDamageAppliedMessage(target, breakdown) {
  const targetName = target?.name ?? game.i18n.localize("MRQOL.Automation.Damage.UnknownTarget");
  const hpDamage = Number(breakdown?.hpDamage ?? 0) || 0;
  const attrDamage = Number(breakdown?.attrDamage ?? 0) || 0;
  const stat = statShortLabel(breakdown?.overflowStat ?? "strength");

  // If no overflow, omit attribute part for cleaner UX
  const contentKey =
    attrDamage > 0
      ? "MRQOL.Automation.Damage.ChatAppliedOverflow"
      : "MRQOL.Automation.Damage.ChatAppliedHpOnly";

  const content = game.i18n.format(contentKey, {
    target: targetName,
    hp: hpDamage,
    attr: attrDamage,
    stat
  });

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

  const roll = await (new Roll("1d20")).evaluate({ async: true });
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

  // Prevent re-applying the same message damage to the same target unless it was undone
  if (isDamageAppliedToTarget(message, target)) {
    warn("MRQOL.Automation.Damage.AlreadyApplied");
    return false;
  }

  const overflowStat = extractOverflowStat(message);

  // Read "before" snapshot for undo
  const before = readHpAndStat(target.actor, overflowStat);

  // Apply
  const breakdown = await applyDamageToToken(target, damage, overflowStat);

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
  } catch (err) {
    // Non-fatal: damage already applied
    console.warn("MRQOL | Failed to set damage ledger", err);
  }

  info("MRQOL.Automation.Damage.Applied");
  await postDamageAppliedMessage(target, breakdown);

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
  const data = ledger.applied?.[actorUuid] ?? null;

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

  const root = html?.[0] instanceof HTMLElement ? html[0] : html;
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
    applyBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> ${game.i18n.localize(
      "MRQOL.Automation.Damage.Apply"
    )}`;
    applyBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        await tryApplyDamageFromMessage(message);
      } catch (err) {
        console.error("MRQOL | Failed to apply damage", err);
        warn("MRQOL.Automation.Damage.Failed");
      }
    });

    btnRow.appendChild(applyBtn);
  }

  // Undo button (only when undo data exists; no duplicates)
// Determine current target state for button enable/disable
const currentTarget = getSingleTarget();
const alreadyApplied = currentTarget ? isDamageAppliedToTarget(message, currentTarget) : false;
const entry = currentTarget ? getLedgerEntryForTarget(message, currentTarget) : null;

// If a target is selected and damage already applied for it, disable Apply
const applyBtnEl = btnRow.querySelector("button.mrqol-apply-damage");
if (applyBtnEl instanceof HTMLButtonElement) {
  applyBtnEl.disabled = !!alreadyApplied;
}

// Undo button: show only if there is ledger data for the selected target
if (entry && !btnRow.querySelector("button.mrqol-undo-damage")) {
  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "mrqol-undo-damage";
  undoBtn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${game.i18n.localize(
    "MRQOL.Automation.Undo.Button"
  )}`;
  undoBtn.disabled = !!entry.used;

  undoBtn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      await tryUndoDamageFromMessage(message);
    } catch (err) {
      console.error("MRQOL | Failed to undo damage", err);
      warn("MRQOL.Automation.Damage.Failed");
    }
  });

  btnRow.appendChild(undoBtn);
}
}

function onCreateChatMessage(message) {
  if (!isFeatureEnabled()) return;
  if (!isAutoApplyEnabled()) return;

  // Only auto-apply when there's exactly one target.
  const target = getSingleTarget();
  if (!target) return;

  // Fire-and-forget (but still catch errors)
  tryApplyDamageFromMessage(message).catch((err) => {
    console.error("MRQOL | Auto-apply damage failed", err);
    warn("MRQOL.Automation.Damage.Failed");
  });
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

    Hooks.on("renderChatMessage", onRenderChatMessage);
    Hooks.on("createChatMessage", onCreateChatMessage);
	Hooks.on("updateActor", onUpdateActor);
  },
  ready() {}
};

PackManager.register(AutomationPack);