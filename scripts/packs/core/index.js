import { PackManager } from "../../framework/packs.js";
import { MODULE_ID } from "../../framework/paths.js";
import { repairItem, getRepairQuote } from "./repairs.js";
import { registerCharacterCreator } from "./character-creator/index.js";
import { registerI18nSyncButtons } from "./i18n-sync.js";

/* -------------------------------------------- */
/* Repairs                                      */
/* -------------------------------------------- */

function getItemFromApp(app) {
  const item = app?.item ?? app?.document;
  if (!item) return null;
  if (item.documentName === "Item") return item;
  return null;
}

function getRootElement(app, html) {
  const el = app?.element;
  if (el instanceof HTMLElement) return el;
  if (el?.[0] instanceof HTMLElement) return el[0];

  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];

  return null;
}

function notifyQuoteFailure(reason) {
  const map = {
    noActor: "MRQOL.Repairs.NoActor",
    noPips: "MRQOL.Repairs.NoPips",
    nothingToRepair: "MRQOL.Repairs.NothingToRepair"
  };

  const key = map[reason] ?? "MRQOL.Repairs.NothingToRepair";
  if (reason === "noActor") ui.notifications.warn(game.i18n.localize(key));
  else ui.notifications.info(game.i18n.localize(key));
}

async function confirmRepairWithCost(item, amount) {
  const quote = getRepairQuote(item, amount);

  if (!quote?.ok) {
    notifyQuoteFailure(quote?.reason);
    return false;
  }

  const title = game.i18n.localize("MRQOL.Repairs.ConfirmTitle");
  const notEnough = quote.currency < quote.total;
  const warn = notEnough ? `<p><strong>${game.i18n.localize("MRQOL.Repairs.Insufficient")}</strong></p>` : "";

  const content = `
    ${warn}
    <p>${game.i18n.format("MRQOL.Repairs.ConfirmCost", {
      pips: quote.toRepair,
      total: quote.total,
      perPip: quote.perPip
    })}</p>
    <p><small>${game.i18n.format("MRQOL.Repairs.YouHave", { have: quote.currency })}</small></p>
  `;

  return Dialog.confirm({ title, content });
}

function injectRepairsUI(app, html) {
  if (!game.settings.get(MODULE_ID, "core.repairs.enabled")) return;

  const item = getItemFromApp(app);
  if (!item?.actor) return;

  const root = getRootElement(app, html);
  if (!root) return;

  if (root.querySelector(".mrqol-repairs")) return;

  const container = document.createElement("div");
  container.classList.add("mrqol-repairs");
  container.innerHTML = `
    <button type="button" class="mrqol-repair-one">
      <i class="fa-solid fa-hammer"></i> ${game.i18n.localize("MRQOL.Repairs.RepairOne")}
    </button>
    <button type="button" class="mrqol-repair-all">
      <i class="fa-solid fa-screwdriver-wrench"></i> ${game.i18n.localize("MRQOL.Repairs.RepairAll")}
    </button>
  `;

  container.querySelector(".mrqol-repair-one")?.addEventListener("click", async () => {
    const ok = await confirmRepairWithCost(item, 1);
    if (ok) await repairItem(item, 1);
  });

  container.querySelector(".mrqol-repair-all")?.addEventListener("click", async () => {
    const ok = await confirmRepairWithCost(item, "all");
    if (ok) await repairItem(item, "all");
  });

  const anchor = root.querySelector(".pips, .item-pips, .pip-container, [data-pips]");
  if (anchor) anchor.insertAdjacentElement("afterend", container);
  else root.querySelector("form")?.prepend(container);
}

function addHeaderButtons(app, buttons) {
  if (!game.settings.get(MODULE_ID, "core.repairs.enabled")) return;
  if (!Array.isArray(buttons)) return;

  const item = getItemFromApp(app);
  if (!item?.actor) return;

  // Avoid duplicate injection if multiple hooks fire for the same sheet.
  if (buttons.some((b) => b?.class === "mrqol-repair-one" || b?.class === "mrqol-repair-all")) return;

  buttons.unshift(
    {
      label: game.i18n.localize("MRQOL.Repairs.RepairOne"),
      class: "mrqol-repair-one",
      icon: "fa-solid fa-hammer",
      onclick: async () => {
        const ok = await confirmRepairWithCost(item, 1);
        if (ok) await repairItem(item, 1);
      }
    },
    {
      label: game.i18n.localize("MRQOL.Repairs.RepairAll"),
      class: "mrqol-repair-all",
      icon: "fa-solid fa-screwdriver-wrench",
      onclick: async () => {
        const ok = await confirmRepairWithCost(item, "all");
        if (ok) await repairItem(item, "all");
      }
    }
  );
}

/* -------------------------------------------- */
/* Pips UI helper (Broken / Empty indicator)     */
/* -------------------------------------------- */

function injectPipsStateToItemSheet(app, html) {
  if (!game.settings.get(MODULE_ID, "core.pipsHelpers.enabled")) return;

  const item = getItemFromApp(app);
  if (!item) return;

  const root = getRootElement(app, html);
  if (!root) return;

  const state = getUsageStateIcon(item);

  // Remove previous overlays (avoid duplicates on re-render)
  root.querySelectorAll(".mrqol-usage-indicator-sheet").forEach((n) => n.remove());

  if (!state) return;

  // Find the primary item image in the sheet (be conservative)
  const img =
    root.querySelector("img.profile") ||
    root.querySelector(".sheet-header img") ||
    root.querySelector("header img") ||
    root.querySelector("img");

  if (!img) return;

  // Use the existing parent container to avoid resizing/reflow
  const container = img.parentElement;
  if (!container) return;

  container.classList.add("mrqol-item-image-wrap");

  const badge = document.createElement("span");
  badge.className = "mrqol-usage-indicator-sheet";

  // Tooltip on hover
  badge.setAttribute("title", state.title);

  // Mask (no square edges)
  badge.style.webkitMaskImage = `url("${state.src}")`;
  badge.style.maskImage = `url("${state.src}")`;

  container.appendChild(badge);
}

/* -------------------------------------------- */
/* Inventory Layout + Rules                     */
/* -------------------------------------------- */

const INV_FLAG_KEY = "layout";
const ENCUMBERED_ID = "encumbered";
const ENCUMBERED_ICON = `modules/${MODULE_ID}/assets/icons/Encumbered.png`;
const OVERFLOW_ICON = `modules/${MODULE_ID}/assets/icons/overflow.svg`;
const BROKEN_ICON = `modules/${MODULE_ID}/assets/icons/Broken.png`;
const EMPTY_ICON = `modules/${MODULE_ID}/assets/icons/Empty.png`;
const INVALID_PLACEMENT_FLAG = "invalidPlacement";
const EQUIPPED_FLAG = "equipped";
const GRIT_ACTIVE_FLAG = "gritActive";

const OVERFLOW_ZONE = "overflow";
const OVERFLOW_TOGGLE_CLASS = "mrqol-overflow-toggle";
const OVERFLOW_CONTAINER_ID = "mrqol-overflow-container";

let __mrqolLastRollActorId = null;
const __mrqolEncInFlight = new Map();

/**
 * Detect Item Piles actors (do not apply overflow/encumbrance).
 * @param {Actor} actor
 */
function isItemPilesActor(actor) {
  try {
    if (actor?.type && String(actor.type).toLowerCase().includes("pile")) return true;

    const f = actor?.flags?.["item-piles"];
    if (!f) return false;

    if (f.enabled === true) return true;
    if (f.itemPile === true) return true;

    if (f.data?.enabled === true) return true;
    if (f.data?.itemPile === true) return true;
    if (f.data?.type && String(f.data.type).toLowerCase().includes("pile")) return true;

    return false;
  } catch (_) {
    return false;
  }
}

function safeGetSetting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch (_) {
    return fallback;
  }
}

/**
 * Overflow inventory is only supported for these actor types.
 * Storage actors must NOT get overflow.
 * @param {Actor} actor
 */
function isOverflowSupported(actor) {
  if (!actor) return false;
  const t = getActorInventoryType(actor);
  return t === "character" || t === "creature" || t === "hireling";
}

function afterTwoFrames(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function rectFromEl(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

function intersectionArea(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return w * h;
}

function normalizeRotation(deg) {
  const d = Number(deg ?? 0);
  return ((d % 360) + 360) % 360;
}

function getItemFootprint(item) {
  let w = Number(item.system?.size?.width ?? 1);
  let h = Number(item.system?.size?.height ?? 1);

  const rot = normalizeRotation(item.system?.sheet?.rotation ?? 0);
  if (rot === 90 || rot === 270) [w, h] = [h, w];

  return { w, h, rotation: rot };
}

/**
 * Footprint calculation for raw item source data (used in preCreate hooks).
 * @param {any} data
 */
function getFootprintFromItemData(data) {
  let w = Number(data?.system?.size?.width ?? 1);
  let h = Number(data?.system?.size?.height ?? 1);

  const rot = normalizeRotation(data?.system?.sheet?.rotation ?? 0);
  if (rot === 90 || rot === 270) [w, h] = [h, w];

  return { w, h, rotation: rot };
}

/* -------------------------------------------- */
/* Inventory profiles (by actor type)           */
/* -------------------------------------------- */

/** @typedef {"character"|"creature"|"hireling"|"storage"} MRActorType */

/**
 * @param {Actor} actor
 * @returns {MRActorType}
 */
function getActorInventoryType(actor) {
  const t = String(actor?.type ?? "").toLowerCase();
  if (t.includes("storage")) return "storage";
  if (t.includes("hire")) return "hireling";
  if (t.includes("creature")) return "creature";
  return "character";
}

/**
 * @param {MRActorType} invType
 * @returns {{
 *  invType: MRActorType,
 *  zones: Set<string>,
 *  pack: { allowStack: boolean },
 *  rules: { allowConditions: boolean, allowEquip: boolean, hasGrit: boolean }
 * }}
 */
function getInventoryProfile(invType) {
  switch (invType) {
    case "storage":
      return {
        invType,
        zones: new Set(["pack"]),
        pack: { allowStack: false },
        rules: { allowConditions: false, allowEquip: false, hasGrit: false }
      };
    case "hireling":
      return {
        invType,
        zones: new Set(["carried", "pack"]),
        pack: { allowStack: false },
        rules: { allowConditions: true, allowEquip: true, hasGrit: false }
      };
    case "creature":
      return {
        invType,
        zones: new Set(["carried", "pack"]),
        pack: { allowStack: false },
        rules: { allowConditions: true, allowEquip: true, hasGrit: false }
      };
    default:
      return {
        invType: "character",
        zones: new Set(["carried", "worn", "pack", "grit", "bank"]),
        pack: { allowStack: false },
        rules: { allowConditions: true, allowEquip: true, hasGrit: true }
      };
  }
}

/**
 * Get pack capacity for an actor without relying on sheet DOM.
 * @param {Actor} actor
 * @returns {number}
 */
function getActorPackCapacity(actor) {
  const invType = getActorInventoryType(actor);
  if (invType === "storage") {
    const w = Number(actor?.system?.size?.width ?? 0);
    const h = Number(actor?.system?.size?.height ?? 0);
    const cap = (Number.isFinite(w) ? w : 0) * (Number.isFinite(h) ? h : 0);
    return Math.max(0, Math.floor(cap));
  }
  if (invType === "creature" || invType === "hireling") return 4;
  return 6;
}

/* -------------------------------------------- */
/* Encumbered status effect                     */
/* -------------------------------------------- */

function registerEncumberedStatusEffect() {
  CONFIG.statusEffects = Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : [];
  if (CONFIG.statusEffects.some((e) => e.id === ENCUMBERED_ID)) return;

  CONFIG.statusEffects.push({
    id: ENCUMBERED_ID,
    name: "Encumbered",
    img: ENCUMBERED_ICON
  });
}

function getEncumberedEffectIds(actor) {
  const ids = [];
  const effects = actor?.effects ?? [];
  for (const ef of effects) {
    try {
      const statuses = ef.statuses;
      const coreStatusId = ef.getFlag?.("core", "statusId") ?? ef.flags?.core?.statusId;
      if ((statuses && statuses.has?.(ENCUMBERED_ID)) || coreStatusId === ENCUMBERED_ID) {
        ids.push(ef.id);
        continue;
      }
      const img = ef.img ?? ef.icon;
      if ((ef.name === "Encumbered" || ef.label === "Encumbered") && img === ENCUMBERED_ICON) ids.push(ef.id);
    } catch (_) {}
  }
  return ids;
}

function getTokensForActor(actor) {
  const out = [];
  try {
    const active = actor?.getActiveTokens?.(true, true) ?? [];
    for (const t of active) {
      const td = _asTokenDocument(t);
      if (td) out.push(td);
    }
  } catch (_) {}

  const seen = new Set();
  return out.filter((td) => {
    const k = td?.uuid ?? td?.id;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Normalize any Token-like reference to a TokenDocument.
 * @param {any} tokenLike
 * @returns {TokenDocument|null}
 */
function _asTokenDocument(tokenLike) {
  if (!tokenLike) return null;
  if (tokenLike.documentName === "Token") return tokenLike;
  if (tokenLike.document?.documentName === "Token") return tokenLike.document;
  if (tokenLike.token?.document?.documentName === "Token") return tokenLike.token.document;
  return null;
}

async function setEncumberedOnTokens(actor, active, tokenDoc = null) {
  const isActive = !!active;

  // 1) Apply on the base actor (works even without tokens on canvas)
  const canToggleOnActor = typeof actor?.toggleStatusEffect === "function";

  if (canToggleOnActor) {
    await actor.toggleStatusEffect(ENCUMBERED_ID, { active: isActive }).catch(() => {});
  } else {
    // Fallback: add/remove an ActiveEffect on the actor itself
    const existing = getEncumberedEffectIds(actor);
    if (isActive && existing.length === 0) {
      await actor
        .createEmbeddedDocuments("ActiveEffect", [
          {
            name: "Encumbered",
            img: ENCUMBERED_ICON,
            statuses: [ENCUMBERED_ID]
          }
        ])
        .catch(() => {});
    }
    if (!isActive && existing.length > 0) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", existing).catch(() => {});
    }
  }

  // 2) Apply on all active token actors (so the token HUD shows it reliably)
  const tokens = getTokensForActor(actor);
  const primary = _asTokenDocument(tokenDoc);
  if (primary) tokens.unshift(primary);

  const seen = new Set();
  for (const td of tokens) {
    if (!td?.actor) continue;
    const k = td.uuid ?? `${td?.scene?.id ?? "?"}:${td.id ?? "?"}`;
    if (seen.has(k)) continue;
    seen.add(k);

    await td.actor.toggleStatusEffect?.(ENCUMBERED_ID, { active: isActive }).catch(() => {});
  }
}

async function setActorEncumbered(actor, active, tokenDoc = null) {
  if (!actor) return;

  const exclude = safeGetSetting("core.inventoryLayout.encumbrance.excludeItemPiles", true);
  if (exclude && isItemPilesActor(actor)) return;

  const key = actor.uuid ?? actor.id;
  const prev = __mrqolEncInFlight.get(key) ?? Promise.resolve();

  const next = prev.finally(async () => {
    const isActive = !!active;
    await actor.setFlag(MODULE_ID, "encumberedAuto", isActive).catch(() => {});
    await setEncumberedOnTokens(actor, isActive, tokenDoc);
  });

  __mrqolEncInFlight.set(key, next);
  try {
    await next;
  } finally {
    if (__mrqolEncInFlight.get(key) === next) __mrqolEncInFlight.delete(key);
  }
}

/* -------------------------------------------- */
/* Overflow detection + virtual cells           */
/* -------------------------------------------- */

/** @param {Actor} actor */
function getOverflowItemIds(actor) {
  if (!actor) return [];
  const ids = [];
  for (const it of actor.items) {
    const layout = it.getFlag?.(MODULE_ID, INV_FLAG_KEY);
    const cells = layout?.cells ?? [];
    if (Array.isArray(cells) && cells.some((c) => String(c).startsWith(`${OVERFLOW_ZONE}:`))) ids.push(it.id);
  }
  return ids;
}

/** @param {Actor} actor */
function actorHasOverflow(actor) {
  return getOverflowItemIds(actor).length > 0;
}

/**
 * Allocate monotonically increasing "virtual" overflow indices.
 * We do not render overflow slots in the sheet (window-only UI),
 * so uniqueness is the only requirement.
 * @param {Actor} actor
 */
function getNextOverflowIndex(actor) {
  let max = 0;
  for (const it of actor.items) {
    const cells = it.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? [];
    for (const c of cells) {
      const s = String(c);
      if (!s.startsWith(`${OVERFLOW_ZONE}:`)) continue;
      const n = Number(s.split(":")[1]);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

/**
 * Move an item into overflow using virtual cells and move it off-screen on the sheet.
 * @param {Item} item
 */
async function moveItemToOverflowAuto(item) {
  const actor = item?.parent;
  if (!actor) return false;

  const { w, h, rotation } = getItemFootprint(item);

  const start = getNextOverflowIndex(actor);
  const cells = Array.from({ length: w * h }, (_, i) => `${OVERFLOW_ZONE}:${start + i}`);

  // Push offscreen so it doesn't clutter the sheet.
  // (Window is the canonical UI for overflow items.)
  const OFF = -100000;

  await item
    .update({
      [`flags.${MODULE_ID}.${INV_FLAG_KEY}`]: { zone: OVERFLOW_ZONE, cells, w, h, rotation },
      [`flags.${MODULE_ID}.${INVALID_PLACEMENT_FLAG}`]: false,
      "system.sheet.currentX": OFF,
      "system.sheet.currentY": OFF,
      "system.sheet.xOffset": OFF,
      "system.sheet.yOffset": OFF,
      "system.sheet.initialX": OFF,
      "system.sheet.initialY": OFF
    })
    .catch(() => {});

  await refreshEncumbered(actor);
  return true;
}

/* -------------------------------------------- */
/* Encumbrance rule hook                        */
/* -------------------------------------------- */

function shouldBeEncumbered(actor) {
  if (!actor) return false;
  if (!isOverflowSupported(actor)) return false;
  if (isItemPilesActor(actor)) return false;
  return actorHasOverflow(actor);
}

function isEncumberedEffectively(actor) {
  if (!actor) return false;
  if (shouldBeEncumbered(actor)) return true;
  if (getEncumberedEffectIds(actor).length) return true;
  if (actor.getFlag?.(MODULE_ID, "encumbered")) return true;
  if (actor.getFlag?.(MODULE_ID, "encumberedAuto")) return true;
  return false;
}

async function refreshEncumbered(actor, tokenDoc = null) {
  if (!actor) return;
  const auto = shouldBeEncumbered(actor);
  await setActorEncumbered(actor, auto, tokenDoc);
}

function enforceEncumberedOnTokenUpdate(tokenDoc) {
  try {
    const actor = tokenDoc?.actor;
    if (!actor) return;
    const active = shouldBeEncumbered(actor);
    setActorEncumbered(actor, active, tokenDoc).catch(() => {});
  } catch (_) {}
}

/* -------------------------------------------- */
/* Roll dialog forcing (Encumbered)             */
/* -------------------------------------------- */

function bindRollContext(app, root) {
  if (root.dataset.mrqolRollContextHooked === "1") return;
  root.dataset.mrqolRollContextHooked = "1";

  root.addEventListener(
    "click",
    (ev) => {
      const el =
        ev.target?.closest?.(".stat-roll, .list-roll, [data-roll], [data-action*='roll'], [data-action*='Roll']");
      if (!el) return;
      __mrqolLastRollActorId = app?.actor?.id ?? null;
    },
    true
  );
}

function forceAdvantageDialogIfEncumbered() {
  Hooks.on("renderDialog", (app, html) => {
    try {
      const actor = __mrqolLastRollActorId ? game.actors?.get(__mrqolLastRollActorId) : null;
      if (!actor) return;
      if (!isEncumberedEffectively(actor)) return;

      const root = html?.[0] ?? html;
      const select = root?.querySelector?.("#advantage") ?? html?.find?.("#advantage")?.[0];
      if (!select) return;

      select.value = "advantage";
      select.disabled = true;

      const optNone = select.querySelector?.("option[value='none']");
      if (optNone) optNone.disabled = true;

      select.title = "Encumbered: Advantage/Disadvantage forced.";
    } catch (_) {}
  });
}

/* -------------------------------------------- */
/* Visual invalid overlay + stack badge         */
/* -------------------------------------------- */

function ensureInvalidOverlay(itemEl) {
  try {
    const pos = getComputedStyle(itemEl).position;
    if (pos === "static") itemEl.style.position = "relative";
  } catch (_) {}

  let ov = itemEl.querySelector(".mrqol-inv-overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.className = "mrqol-inv-overlay";
    ov.innerHTML = `
      <div class="mrqol-inv-overlay-inner">
        <i class="fas fa-exclamation-triangle"></i>
      </div>
    `;
    itemEl.appendChild(ov);
  }
  return ov;
}

function ensureStackBadge(itemEl) {
  let badge = itemEl.querySelector(".mrqol-pack-stack");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "mrqol-pack-stack";
    itemEl.appendChild(badge);
  }
  return badge;
}

function clearStackBadge(itemEl) {
  const badge = itemEl.querySelector(".mrqol-pack-stack");
  if (badge) badge.remove();
}

function applyItemTitle(itemEl) {
  const invalid = itemEl.dataset.mrqolInvalidTitle;
  const stack = itemEl.dataset.mrqolStackTitle;
  const title = invalid || stack || "";
  if (title) itemEl.setAttribute("title", title);
  else itemEl.removeAttribute("title");
}

function clearInvalidMark(itemEl) {
  itemEl.classList.remove("mrqol-inv-invalid");
  delete itemEl.dataset.mrqolInvalidTitle;

  const ov = itemEl.querySelector(".mrqol-inv-overlay");
  if (ov) ov.remove();

  applyItemTitle(itemEl);
}

function markInvalid(itemEl, message) {
  itemEl.classList.add("mrqol-inv-invalid");
  itemEl.dataset.mrqolInvalidTitle = message;
  itemEl.setAttribute("title", message);
  ensureInvalidOverlay(itemEl);
  applyItemTitle(itemEl);
}

/* -------------------------------------------- */
/* Zone restrictions                            */
/* -------------------------------------------- */

function allowedZonesForItem(item) {
  if (item.type === "condition") return new Set(["pack", "grit", OVERFLOW_ZONE]);
  return null;
}

function allowedZonesForItemByProfile(item, profile) {
  const invType = profile?.invType ?? "character";

  if (invType === "storage") {
    if (item.type === "condition") return new Set();
    return new Set(["pack"]);
  }

  if (item.type === "condition") {
    if (invType === "character") return new Set(["pack", "grit", OVERFLOW_ZONE]);
    return new Set(["pack", OVERFLOW_ZONE]);
  }

  return null;
}

function isZoneAllowedForItem(item, zone, profile = null) {
  const allowed = profile ? allowedZonesForItemByProfile(item, profile) : allowedZonesForItem(item);
  if (!allowed) return true;
  return allowed.has(zone);
}

/* -------------------------------------------- */
/* Overlap policy                               */
/* -------------------------------------------- */

function isExclusiveCell(cellId, _profile = null) {
  // With this module configuration, ALL cells are exclusive.
  // (No stacking.)
  if (!cellId) return true;
  return true;
}

function isPlacementBlocked(placement, occupied, profile = null) {
  if (!placement?.cells?.length) return false;
  if (!occupied) return false;
  return placement.cells.some((cid) => isExclusiveCell(String(cid), profile) && occupied.has(cid));
}

/* -------------------------------------------- */
/* Inventory cell map from DOM                  */
/* -------------------------------------------- */

function buildInventoryCells(root, actor = null) {
  const dragArea = root.querySelector("#drag-area");
  if (!dragArea) return null;

  const invType = actor ? getActorInventoryType(actor) : "character";
  const profile = getInventoryProfile(invType);

  const slotEls = Array.from(dragArea.querySelectorAll(".item-slot-dashed"));
  const cells = [];
  const packSlotsByN = {};
  const slotPosByCellId = {};

  const parseTranslate3d = (el) => {
    const raw = el?.style?.transform || getComputedStyle(el)?.transform;
    if (!raw || raw === "none") return null;

    let m = raw.match(/translate3d\(\s*([\-\d.]+)px\s*,\s*([\-\d.]+)px/i);
    if (m) return { x: Number(m[1]), y: Number(m[2]) };

    m = raw.match(/translate\(\s*([\-\d.]+)px\s*,\s*([\-\d.]+)px/i);
    if (m) return { x: Number(m[1]), y: Number(m[2]) };

    m = raw.match(
      /matrix\(\s*[\-\d.]+\s*,\s*[\-\d.]+\s*,\s*[\-\d.]+\s*,\s*[\-\d.]+\s*,\s*([\-\d.]+)\s*,\s*([\-\d.]+)\s*\)/i
    );
    if (m) return { x: Number(m[1]), y: Number(m[2]) };

    m = raw.match(/matrix3d\((.+)\)/i);
    if (m) {
      const parts = m[1]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      if (parts.length === 16) return { x: parts[12], y: parts[13] };
    }

    return null;
  };

  // --- Pack cells (variable) ---
  for (const el of slotEls) {
    const bagText = el.querySelector(".item-bag-text");
    if (!bagText) continue;

    const n = Number(bagText.textContent.trim());
    if (!Number.isFinite(n)) continue;

    packSlotsByN[n] = el;

    const pos = parseTranslate3d(el);
    if (pos) slotPosByCellId[`pack:${n}`] = pos;

    cells.push({ id: `pack:${n}`, zone: "pack", rect: rectFromEl(el), el });
  }

  const packNumbers = Object.keys(packSlotsByN)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const packCount = packNumbers.length ? Math.max(...packNumbers) : 0;

  // --- Determine inventory-space cell size using SIGNED deltas ---
  let cellWInv = null;
  let cellHInv = null;

  if (slotPosByCellId["pack:1"] && slotPosByCellId["pack:2"]) {
    cellWInv = slotPosByCellId["pack:2"].x - slotPosByCellId["pack:1"].x;
  }
  if (slotPosByCellId["pack:1"] && slotPosByCellId["pack:4"]) {
    cellHInv = slotPosByCellId["pack:4"].y - slotPosByCellId["pack:1"].y;
  }

  if (!Number.isFinite(cellWInv)) {
    const r = packSlotsByN[1]?.getBoundingClientRect();
    cellWInv = r?.width ?? 100;
  }
  if (!Number.isFinite(cellHInv)) {
    const r = packSlotsByN[1]?.getBoundingClientRect();
    cellHInv = r?.height ?? 100;
  }

  // --- Special slots by header (profile-aware) ---
  const specials = [];
  for (const el of slotEls) {
    const header = el.querySelector(".item-slot-header")?.textContent?.trim();
    if (!header) continue;

    if (profile.zones.has("carried")) {
      if (/(main\s*paw|pata\s*principal|attack|ataque|carried|pata)/i.test(header)) {
        specials.push({ id: "carried:_", zone: "carried", rect: rectFromEl(el), el });
        continue;
      }
      if (/(off\s*paw|pata\s*sec|pata\s*secund)/i.test(header)) {
        specials.push({ id: "carried:_", zone: "carried", rect: rectFromEl(el), el });
        continue;
      }
    }

    if (profile.zones.has("worn")) {
      if (/(body|cuerpo)/i.test(header)) specials.push({ id: "worn:body", zone: "worn", rect: rectFromEl(el), el });
    }

    if (profile.zones.has("grit")) {
      if (/(grit|agallas)/i.test(header)) specials.push({ id: "grit:all", zone: "grit", rect: rectFromEl(el), el });
    }

    if (profile.zones.has("bank")) {
      if (/(bank|banco)/i.test(header)) specials.push({ id: "bank:all", zone: "bank", rect: rectFromEl(el), el });
    }
  }

  // Normalize carried slots: keep first two in DOM order
  if (profile.zones.has("carried")) {
    const carried = specials.filter((s) => s.zone === "carried");
    for (let i = specials.length - 1; i >= 0; i--) if (specials[i].zone === "carried") specials.splice(i, 1);
    if (carried[0]) specials.push({ ...carried[0], id: "carried:main" });
    if (carried[1]) specials.push({ ...carried[1], id: "carried:off" });
  }

  // Split Body into top/bottom
  const bodySlots = specials.filter((s) => s.id === "worn:body").sort((a, b) => a.rect.top - b.rect.top);
  for (let i = specials.length - 1; i >= 0; i--) if (specials[i].id === "worn:body") specials.splice(i, 1);
  if (bodySlots[0]) specials.push({ ...bodySlots[0], id: "worn:top" });
  if (bodySlots[1]) specials.push({ ...bodySlots[1], id: "worn:bottom" });

  // Add carried/worn + positions
  for (const s of specials) {
    if (["carried:main", "carried:off", "worn:top", "worn:bottom"].includes(s.id)) {
      const pos = parseTranslate3d(s.el);
      if (pos) slotPosByCellId[s.id] = pos;
      cells.push({ id: s.id, zone: s.zone, rect: s.rect, el: s.el });
    }
  }

  // Split Grit into 2 cells
  const gritAll = specials.find((s) => s.id === "grit:all");
  if (gritAll) {
    const r = gritAll.rect;
    const cwScreen = r.width / 2;

    const pos = parseTranslate3d(gritAll.el);
    if (pos) {
      const step = Number(cellWInv ?? 0) || 0;
      const half = step ? step / 2 : 0;
      slotPosByCellId["grit:1"] = { x: pos.x - half, y: pos.y };
      slotPosByCellId["grit:2"] = { x: pos.x + half, y: pos.y };
    }

    cells.push({ id: "grit:1", zone: "grit", rect: { ...r, right: r.left + cwScreen, width: cwScreen } });
    cells.push({ id: "grit:2", zone: "grit", rect: { ...r, left: r.left + cwScreen, width: cwScreen } });
  }

  // Split Bank into 3 cells
  const bankAll = specials.find((s) => s.id === "bank:all");
  if (bankAll) {
    const r = bankAll.rect;
    const cwScreen = r.width / 3;

    const pos = parseTranslate3d(bankAll.el);
    if (pos) {
      const step = Number(cellWInv ?? 0) || 0;
      slotPosByCellId["bank:1"] = { x: pos.x - step, y: pos.y };
      slotPosByCellId["bank:2"] = { x: pos.x, y: pos.y };
      slotPosByCellId["bank:3"] = { x: pos.x + step, y: pos.y };
    }

    for (let i = 0; i < 3; i++) {
      cells.push({
        id: `bank:${i + 1}`,
        zone: "bank",
        rect: { ...r, left: r.left + cwScreen * i, right: r.left + cwScreen * (i + 1), width: cwScreen }
      });
    }
  }

  // Pack grid shape
  const uniq = (vals, tol = 1) => {
    const out = [];
    for (const v of vals.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)) {
      if (!out.length || Math.abs(out[out.length - 1] - v) > tol) out.push(v);
    }
    return out;
  };

  const px = packNumbers.map((n) => slotPosByCellId[`pack:${n}`]?.x).filter((n) => Number.isFinite(n));
  const py = packNumbers.map((n) => slotPosByCellId[`pack:${n}`]?.y).filter((n) => Number.isFinite(n));

  let packCols = uniq(px).length;
  let packRows = uniq(py).length;
  if (!packCols || !packRows || packCols * packRows < packCount) {
    packCols = packCount || 0;
    packRows = packCols ? 1 : 0;
  }

  const packIndexToCR = (n) => {
    const idx = n - 1;
    const cols = Math.max(1, packCols);
    return { col: idx % cols, row: Math.floor(idx / cols) };
  };
  const packCRToIndex = (col, row) => row * Math.max(1, packCols) + col + 1;

  return {
    profile,
    invType,
    cells,
    packSlotsByN,
    slotPosByCellId,
    cellWInv,
    cellHInv,
    pack: { count: packCount, cols: packCols, rows: packRows, numbers: packNumbers },
    packIndexToCR,
    packCRToIndex
  };
}

/* -------------------------------------------- */
/* Special placements (equipment)               */
/* -------------------------------------------- */

function getSpecialPlacement(item, anchorCellId, w, h, map) {
  const profile = map?.profile ?? getInventoryProfile("character");
  const hasWorn = profile.zones?.has?.("worn");
  const type = item.type;

  if (type === "armor" && w === 2 && h === 1) {
    if (!hasWorn) return null;
    if (anchorCellId === "carried:off" || anchorCellId === "worn:bottom")
      return { zone: "worn", cells: ["carried:off", "worn:bottom"] };
    return null;
  }

  if (type === "armor" && w === 1 && h === 2) {
    if (!hasWorn) return null;
    if (anchorCellId === "worn:top" || anchorCellId === "worn:bottom")
      return { zone: "worn", cells: ["worn:top", "worn:bottom"] };
    return null;
  }

  if (type === "weapon" && w === 1 && h === 2) {
    if (anchorCellId === "carried:main" || anchorCellId === "carried:off") {
      return { zone: "carried", cells: ["carried:main", "carried:off"] };
    }
    return null;
  }

  return null;
}

function getPlacementForAnchor(item, anchorCell, w, h, map) {
  if (!isZoneAllowedForItem(item, anchorCell.zone, map?.profile ?? null)) return null;

  const special = getSpecialPlacement(item, anchorCell.id, w, h, map);
  if (special) return special;

  const id = anchorCell.id;

  if (id.startsWith("carried:") || id.startsWith("worn:")) {
    if (w === 1 && h === 1) return { zone: anchorCell.zone, cells: [id] };
    return null;
  }

  if (id.startsWith("grit:")) {
    // ✅ NEW: respect actual grit capacity
    const cap = getGritCapacity(item?.parent ?? map?.actor ?? null);
    if (cap <= 0) return null;

    if (h !== 1) return null;
    const start = Number(id.split(":")[1]);
    if (!Number.isFinite(start) || start < 1 || start > cap) return null;   // ✅ use cap
    if (start + w - 1 > cap) return null;                                   // ✅ use cap
    return { zone: "grit", cells: Array.from({ length: w }, (_, i) => `grit:${start + i}`) };
  }

  if (id.startsWith("bank:")) {
    if (h !== 1) return null;
    const start = Number(id.split(":")[1]);
    if (!Number.isFinite(start) || start < 1 || start > 3) return null;
    if (start + w - 1 > 3) return null;
    return { zone: "bank", cells: Array.from({ length: w }, (_, i) => `bank:${start + i}`) };
  }

  if (id.startsWith("pack:")) {
    const start = Number(id.split(":")[1]);
    const packCount = Number(map?.pack?.count ?? 0) || 0;
    if (!Number.isFinite(start) || start < 1 || (packCount && start > packCount)) return null;

    const cols = Math.max(1, Number(map?.pack?.cols ?? 0) || 1);
    const rows = Math.max(1, Number(map?.pack?.rows ?? 0) || 1);

    const { col: c0, row: r0 } = map.packIndexToCR(start);
    if (c0 + w - 1 > cols - 1) return null;
    if (r0 + h - 1 > rows - 1) return null;

    const out = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const n = map.packCRToIndex(c0 + dx, r0 + dy);
        if (packCount && n > packCount) return null;
        out.push(`pack:${n}`);
      }
    }
    return { zone: "pack", cells: out };
  }

  return null;
}

function buildOccupiedSet(actor, excludeItemId) {
  const occupied = new Set();
  for (const it of actor.items) {
    if (it.id === excludeItemId) continue;
    const layout = it.getFlag(MODULE_ID, INV_FLAG_KEY);
    if (!layout?.cells) continue;
    for (const cid of layout.cells) occupied.add(cid);
  }
  return occupied;
}

function findBestPlacement(item, itemRect, w, h, map, { threshold = 0.35, strict = true, occupied = null } = {}) {
  let best = null;

  for (const c of map.cells) {
    const area = intersectionArea(itemRect, c.rect);
    if (area <= 0) continue;

    const ratio = area / (c.rect.width * c.rect.height);
    if (ratio < threshold) continue;

    const placement = getPlacementForAnchor(item, c, w, h, map);
    if (!placement) continue;

    if (strict && occupied) {
      const blocked = placement.cells.some((cid) => isExclusiveCell(cid, map?.profile ?? null) && occupied.has(cid));
      if (blocked) continue;
    }

    if (!best || area > best.area) best = { anchor: c, placement, area };
  }

  return best;
}

/* -------------------------------------------- */
/* Pack auto-placement                          */
/* -------------------------------------------- */

function getPackCellCounts(actor, excludeItemId = null) {
  const cap = Math.max(0, getActorPackCapacity(actor));
  /** @type {Record<number, number>} */
  const counts = {};
  for (let i = 1; i <= cap; i++) counts[i] = 0;

  for (const it of actor.items) {
    if (excludeItemId && it.id === excludeItemId) continue;
    const layout = it.getFlag(MODULE_ID, INV_FLAG_KEY);
    if (!layout?.cells) continue;
    for (const cid of layout.cells) {
      if (!cid.startsWith("pack:")) continue;
      const n = Number(cid.split(":")[1]);
      if (!Number.isFinite(n) || !(n in counts)) continue;
      counts[n] += 1;
    }
  }

  return counts;
}

function chooseAutoPackPlacement(item, w, h, map, counts) {
  const candidates = [];
  const packCount = Number(map?.pack?.count ?? 0) || 0;
  if (!packCount) return null;

  for (let start = 1; start <= packCount; start++) {
    const anchor = map.cells.find((c) => c.id === `pack:${start}`);
    if (!anchor) continue;

    const placement = getPlacementForAnchor(item, anchor, w, h, map);
    if (!placement || placement.zone !== "pack") continue;

    const cellNums = placement.cells
      .filter((c) => c.startsWith("pack:"))
      .map((c) => Number(c.split(":")[1]))
      .filter((n) => Number.isFinite(n));

    if (!cellNums.length) continue;

    const allEmpty = cellNums.every((n) => (counts[n] ?? 0) === 0);
    candidates.push({ start, anchor, placement, allEmpty });
  }

  candidates.sort((a, b) => a.start - b.start);
  return candidates.find((c) => c.allEmpty) ?? null;
}

/* -------------------------------------------- */
/* Overflow window UI                           */
/* -------------------------------------------- */

const __mrqolOverflowApps = new Map();

// ---- Overflow window geometry (must match your _renderInner numbers)
const OV_COLS = 3;
const OV_STEP_X = 130;
const OV_STEP_Y = 130;
const OV_BASE_Y = -65; // first row y
// x = (col-1)*130 => -130,0,130
function ovSlotXYFromIndex(idx) {
  const i0 = Math.max(0, idx - 1);
  const col = i0 % OV_COLS;
  const row = Math.floor(i0 / OV_COLS);
  return { x: (col - 1) * OV_STEP_X, y: OV_BASE_Y + row * OV_STEP_Y };
}

function getOverflowIndexFromDropEvent(ev, containerEl) {
  // containerEl = #mrqol-ov-drag-area
  const rect = containerEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // coords in the same "center-origin" space used by translate3d
  const x = ev.clientX - cx;
  const y = ev.clientY - cy;

  // find nearest col/row
  const col = Math.round(x / OV_STEP_X) + 1; // -130->0->+130 => cols 0..2 => +1
  const row = Math.round((y - OV_BASE_Y) / OV_STEP_Y); // row 0 at -65

  const c = Math.max(0, Math.min(OV_COLS - 1, col - 1));
  const r = Math.max(0, row);

  return r * OV_COLS + c + 1;
}

function getOccupiedOverflowCells(actor, excludeItemId = null) {
  const occ = new Set();
  for (const it of actor.items) {
    if (excludeItemId && it.id === excludeItemId) continue;
    const cells = it.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? [];
    for (const c of cells) {
      const s = String(c);
      if (s.startsWith(`${OVERFLOW_ZONE}:`)) occ.add(s);
    }
  }
  return occ;
}

function placementCellsForOverflowIndex(startIndex, w, h) {
  const cells = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx0 = (startIndex - 1) + dx + dy * OV_COLS;
      cells.push(`${OVERFLOW_ZONE}:${idx0 + 1}`);
    }
  }
  return cells;
}

function canPlaceOverflowAt(actor, startIndex, w, h, excludeItemId = null) {
  // must not exceed cols in a row
  const col0 = (startIndex - 1) % OV_COLS;
  if (col0 + w > OV_COLS) return false;

  const occ = getOccupiedOverflowCells(actor, excludeItemId);
  const cells = placementCellsForOverflowIndex(startIndex, w, h);
  for (const cid of cells) if (occ.has(cid)) return false;
  return true;
}

async function setItemOverflowAtIndex(item, startIndex) {
  const actor = item?.parent;
  if (!actor) return false;

  const { w, h, rotation } = getItemFootprint(item);

  // if can't place there, fall back to first free
  let idx = startIndex;
  if (!canPlaceOverflowAt(actor, idx, w, h, item.id)) {
    // scan from 1 upward
    for (let t = 1; t < 999; t++) {
      if (canPlaceOverflowAt(actor, t, w, h, item.id)) { idx = t; break; }
    }
  }

  const cells = placementCellsForOverflowIndex(idx, w, h);

  const OFF = -100000;
  await item.update({
    [`flags.${MODULE_ID}.${INV_FLAG_KEY}`]: { zone: OVERFLOW_ZONE, cells, w, h, rotation },
    [`flags.${MODULE_ID}.${INVALID_PLACEMENT_FLAG}`]: false,
    "system.sheet.currentX": OFF,
    "system.sheet.currentY": OFF,
    "system.sheet.xOffset": OFF,
    "system.sheet.yOffset": OFF,
    "system.sheet.initialX": OFF,
    "system.sheet.initialY": OFF
  }).catch(() => {});

  return true;
}

class OverflowInventoryApp extends Application {
  /** @param {Actor} actor */
  constructor(actor) {
    super();
    this.actor = actor;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mrqol-overflow-window",
      popOut: true,
      resizable: true,
      minimizable: true,
      width: 420,
      height: 520,
      template: null
    });
  }

  get title() {
    const n = getOverflowItemIds(this.actor).length;
    return `${game.i18n.localize("MRQOL.Overflow.Title") || "Overflow"} (${n})`;
  }

  /** Render simple HTML without templates */
  async _renderInner(_data) {
    const actor = this.actor;

    const cols = 3;
    const minRows = 2;

    // Slot geometry (matching your inspector)
    const stepX = 130;
    const stepY = 130;
    const baseX = -130;     // -130, 0, +130
    const baseYSlots = -65; // slots row 0
    const baseYCards = -60; // cards in sheet tend to be -60

    // Collect overflow items + max index
    const overflowItems = actor.items
      .filter((it) => {
        const cells = it.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? [];
        return Array.isArray(cells) && cells.some((c) => String(c).startsWith(`${OVERFLOW_ZONE}:`));
      })
      .map((it) => {
        const layout = it.getFlag(MODULE_ID, INV_FLAG_KEY) ?? {};
        const cells = Array.isArray(layout.cells) ? layout.cells : [];
        const idxs = cells
          .map((c) => String(c))
          .filter((s) => s.startsWith(`${OVERFLOW_ZONE}:`))
          .map((s) => Number(s.split(":")[1]))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);

        const anchorIndex = idxs.length ? idxs[0] : 999999;
        const maxIndex = idxs.length ? idxs[idxs.length - 1] : 0;
        return { it, anchorIndex, maxIndex };
      })
      .sort((a, b) => a.anchorIndex - b.anchorIndex || String(a.it.name ?? "").localeCompare(String(b.it.name ?? "")));

    let maxIndexUsed = 0;
    for (const o of overflowItems) maxIndexUsed = Math.max(maxIndexUsed, o.maxIndex || 0);

    const rows = Math.max(minRows, Math.ceil((maxIndexUsed || 1) / cols));
    const totalSlots = rows * cols;

    const width = 425;
    const height = 295 + Math.max(0, rows - 2) * stepY;

    const slotsHtml = Array.from({ length: totalSlots }, (_, i) => {
      const n = i + 1;
      const col = (n - 1) % cols;
      const row = Math.floor((n - 1) / cols);

      const x = baseX + col * stepX;
      const y = baseYSlots + row * stepY;

      return `
        <div class="item-slot-dashed" data-ov-slot="${n}"
             style="transform: translate3d(${x}px, ${y}px, 0px);">
          <div class="item-bag-text">${n}</div>
        </div>
      `;
    }).join("");

    const buildPipsHtml = (it) => {
  const pipsMax = Number(it.system?.pips?.max ?? 0) || 0;
  const pipsVal = Number(it.system?.pips?.value ?? 0) || 0;
  if (!pipsMax) return "";

  const icons = Array.from({ length: pipsMax }, (_, i) => {
    const filled = i < pipsVal;
    const cls = filled ? "fas fa-circle" : "far fa-circle";
    return `<i class="${cls}" data-pip-index="${i + 1}"></i>`;
  }).join("");

  return `<div class="grid grid-3col pip-button mrqol-ov-pips" style="width:50px; margin:5px;">${icons}</div>`;
};

    const itemsHtml = overflowItems.map(({ it, anchorIndex }) => {
      const { w, h } = getItemFootprint(it);

      const idx = Math.max(1, anchorIndex);
      const col = (idx - 1) % cols;
      const row = Math.floor((idx - 1) / cols);

      const slotX = baseX + col * stepX;
      const slotY = baseYCards + row * stepY;

      const offX = ((Math.max(1, w) - 1) * stepX) / 2;
      const offY = ((Math.max(1, h) - 1) * stepY) / 2;

      const x = slotX + offX;
      const y = slotY + offY;

      const cardW = `${9 * Math.max(1, w)}em`;
      const cardH = `${9 * Math.max(1, h)}em`;

      const style = `width:${cardW}; height:${cardH}; transform: translate3d(${x}px, ${y}px, 0px);`;

      const name = foundry.utils.escapeHTML(it.name ?? "");
      const tagVal = it.system?.tag ?? it.system?.category ?? "";
      const tag = tagVal ? `<div class="item-card-tag">${foundry.utils.escapeHTML(String(tagVal))}</div>` : "";

      const pipsHtml = buildPipsHtml(it);
      const rot = normalizeRotation(it.system?.sheet?.rotation ?? 0);

      return `
        <div class="item-card item dragItems dropitem mrqol-ov-item-card"
             data-item-id="${it.id}" id="${it.id}" draggable="true"
             style="${style}">
          <div class="overlay" style="background-color: white;"></div>

          <div class="item-card-header flex-between" data-item-id="${it.id}">
            <div class="list-roll item-roll item-card-title">${name}</div>
            <div class="mrqol-card-toggles"></div>
          </div>

          ${pipsHtml}
          ${tag}

          <img src="${it.img}" title="${name}" class="item-card-image"
               style="transform:rotate(${rot}deg) scale(1);">

          <div class="item-controls item-card-chat">
            <a class="item-control item-rotate" title="Rotate Item"><i class="fas fa-sync-alt"></i></a>
            <a class="item-control item-edit" title="Edit Item"><i class="fas fa-edit"></i></a>
            <a class="item-control item-delete" title="Delete Item"><i class="fas fa-trash"></i></a>
          </div>
        </div>
      `;
    }).join("");

    const hint = game.i18n.localize("MRQOL.Overflow.Hint") || "You are carrying too many things.";

    return $(`
      <div class="mausritter">
        <div class="mrqol-ov-root">
          <p class="mrqol-ov-hint">${hint}</p>

          <div class="item-container mrqol-ov-drag-area" id="mrqol-ov-drag-area"
               style="width:${width}px; height:${height}px;">
            ${slotsHtml}
            ${itemsHtml}
          </div>
        </div>
      </div>
    `);
  }

  activateListeners(html) {
    super.activateListeners(html);

// Drag start (Foundry + Mausritter system compatibility)
html.find(".item-card[data-item-id]").on("dragstart", (ev) => {
  const el = ev.currentTarget;
  const itemId = el?.dataset?.itemId;
  if (!itemId) return;

  const it = this.actor.items.get(itemId);
  if (!it) return;

  // Prefer Foundry-native drag data when available
  const dragData = (typeof it.toDragData === "function")
    ? it.toDragData()
    : { type: "Item", uuid: it.uuid };

  // KEY: Mausritter sheet drop expects a snapshot under `data`
  dragData.data = it.toObject();

  // Helpful extra fields (harmless for Foundry/system; useful for our handlers)
  dragData.actorId = this.actor.id;
  dragData.itemId = itemId;

  const payload = JSON.stringify(dragData);

  // Set both to maximize compatibility across handlers
  ev.originalEvent.dataTransfer.setData("application/json", payload);
  ev.originalEvent.dataTransfer.setData("text/plain", payload);
});

    // Edit / Delete / Rotate
    html.find(".mrqol-ov-item-card .item-control.item-edit").on("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const id = ev.currentTarget.closest(".item-card")?.dataset?.itemId;
      const it = this.actor.items.get(id);
      it?.sheet?.render(true);
    });

    html.find(".mrqol-ov-item-card .item-control.item-delete").on("click", async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const id = ev.currentTarget.closest(".item-card")?.dataset?.itemId;
      const it = this.actor.items.get(id);
      if (!it) return;
      await it.delete().catch(() => {});
      refreshInventoryUIForActor(this.actor).catch(() => {});
      this.render(false);
    });

    html.find(".mrqol-ov-item-card .item-control.item-rotate").on("click", async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const id = ev.currentTarget.closest(".item-card")?.dataset?.itemId;
      const it = this.actor.items.get(id);
      if (!it) return;
      const cur = normalizeRotation(it.system?.sheet?.rotation ?? 0);
      const next = normalizeRotation(cur + 90);
      await it.update({ "system.sheet.rotation": next }).catch(() => {});
      this.render(false);
    });

    // Roll (best effort)
    html.find(".mrqol-ov-item-card .item-roll, .mrqol-ov-item-card .item-card-title").on("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const id = ev.currentTarget.closest(".item-card")?.dataset?.itemId;
      const it = this.actor.items.get(id);
      try {
        it?.roll?.();
      } catch (_) {
        try { it?.use?.(); } catch (_) {}
      }
    });

// Usage pips (toggle by click)
html.find(".mrqol-ov-item-card .mrqol-ov-pips i[data-pip-index]").on("click", async (ev) => {
  ev.preventDefault(); ev.stopPropagation();

  const card = ev.currentTarget.closest(".item-card");
  const itemId = card?.dataset?.itemId;
  if (!itemId) return;

  const it = this.actor.items.get(itemId);
  if (!it) return;

  const idx = Number(ev.currentTarget.dataset.pipIndex || 0);
  if (!Number.isFinite(idx) || idx <= 0) return;

  const cur = Number(it.system?.pips?.value ?? 0) || 0;
  const max = Number(it.system?.pips?.max ?? 0) || 0;
  if (!max) return;

  // Clicked pip: set to idx; clicking the last filled pip decreases by 1 (common UX)
  const next = (idx === cur) ? Math.max(0, cur - 1) : Math.min(max, idx);

  await it.update({ "system.pips.value": next }).catch(() => {});
  this.render(false);
});

    // Drop into overflow window => place at nearest slot index (NO infinite growth)
    html.on("dragover", (ev) => ev.preventDefault());
    html.on("drop", async (ev) => {
      ev.preventDefault();

      const raw = ev.originalEvent.dataTransfer.getData("text/plain");
      if (!raw) return;

      let data;
      try { data = JSON.parse(raw); } catch (_) { return; }

      const uuid = data?.uuid;
      if (!uuid) return;

      const doc = await fromUuid(uuid).catch(() => null);
      if (!doc || doc.documentName !== "Item") return;
      if (doc.parent?.id !== this.actor.id) return;

      const container = html.find("#mrqol-ov-drag-area")[0];
      if (!container) return;

      const idx = getOverflowIndexFromDropEvent(ev.originalEvent, container);
      await setItemOverflowAtIndex(doc, idx);

      refreshInventoryUIForActor(this.actor).catch(() => {});
      this.render(false);
    });
  // Inject toggles in the overflow window (include overflow items)
try {
  const root = html?.[0] ?? html;
  refreshToggleButtonsForRoot(this.actor, root, { includeOverflow: true });
} catch (_) {}
  
  }
}

/*   activateListeners(html) {
    super.activateListeners(html);

// Drag start: provide Foundry with standard item drag data
html.find(".item-card[data-item-id]").on("dragstart", (ev) => {
  const el = ev.currentTarget;
  const itemId = el?.dataset?.itemId;
  if (!itemId) return;

  const it = this.actor.items.get(itemId);
  if (!it) return;

  const dragData = {
    type: "Item",
    uuid: it.uuid,
    actorId: this.actor.id,
    itemId
  };

  ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(dragData));
});

    // Allow dropping items from the sheet into the overflow window
    html.on("dragover", (ev) => ev.preventDefault());
    html.on("drop", async (ev) => {
      ev.preventDefault();
      const raw = ev.originalEvent.dataTransfer.getData("text/plain");
      if (!raw) return;

      let data;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        return;
      }

      const uuid = data?.uuid;
      if (!uuid) return;

      const doc = await fromUuid(uuid).catch(() => null);
      if (!doc || doc.documentName !== "Item") return;
      if (doc.parent?.id !== this.actor.id) return;

      await moveItemToOverflowAuto(doc);
      refreshInventoryUIForActor(this.actor).catch(() => {});
      this.render(false);
    });
  }
} */

function openOverflowWindow(actor) {
  const key = actor.uuid ?? actor.id;

  const existing = __mrqolOverflowApps.get(key);
  if (existing) {
    try { existing.bringToTop?.(); } catch (_) {}
    return existing;
  }

  const app = new OverflowInventoryApp(actor);

  // Patch close() to ensure cleanup even if Application has no event emitter.
  const originalClose = app.close?.bind(app);
  app.close = async (...args) => {
    __mrqolOverflowApps.delete(key);
    try {
      return await originalClose?.(...args);
    } catch (_) {
      // ignore
    }
  };

  __mrqolOverflowApps.set(key, app);

  app.render(true);
  return app;
}

function closeOverflowWindow(actor) {
  const key = actor.uuid ?? actor.id;
  const app = __mrqolOverflowApps.get(key);
  if (!app) return;
  try {
    app.close();
  } catch (_) {
    __mrqolOverflowApps.delete(key);
  }
}

function toggleOverflowWindow(actor) {
  const key = actor.uuid ?? actor.id;
  if (__mrqolOverflowApps.has(key)) closeOverflowWindow(actor);
  else openOverflowWindow(actor);
}

/* -------------------------------------------- */
/* Overflow button on sheet (UI injection)      */
/* -------------------------------------------- */

function removeOverflowUI(root) {
  if (!root) return;
  try {
    root.querySelector(`#${OVERFLOW_CONTAINER_ID}`)?.remove();
  } catch (_) {}
}

function ensureOverflowToggleButton(app, root, overflowCount) {
  const dragArea = root.querySelector("#drag-area");
  if (!dragArea) return;

  let container = root.querySelector(`#${OVERFLOW_CONTAINER_ID}`);
  if (!container) {
    container = document.createElement("div");
    container.id = OVERFLOW_CONTAINER_ID;
    container.classList.add("mrqol-overflow-controls");
    dragArea.insertAdjacentElement("beforebegin", container);
  }

  let btn = container.querySelector(`button.${OVERFLOW_TOGGLE_CLASS}`);
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add(OVERFLOW_TOGGLE_CLASS);
    btn.setAttribute("title", game.i18n.localize("MRQOL.Overflow.Toggle") || "Overflow");
    btn.innerHTML = `
      <img class="mrqol-overflow-icon" src="${OVERFLOW_ICON}" alt="${game.i18n.localize("MRQOL.Overflow.Toggle") || "Overflow"}" />
      <span class="mrqol-overflow-count"></span>
    `;
    btn.addEventListener("click", () => toggleOverflowWindow(app.actor));
    container.appendChild(btn);
  }

  btn.querySelector(".mrqol-overflow-count")?.replaceChildren(document.createTextNode(String(overflowCount ?? 0)));
}

/**
 * Window-only overflow UI:
 * - show a toggle button on the actor sheet only when overflowCount > 0
 * - no overflow slots in the sheet
 */
function ensureOverflowUI(app, root) {
  const actor = app?.actor;
  if (!actor || !root) return;

  if (!isOverflowSupported(actor) || isItemPilesActor(actor)) {
    removeOverflowUI(root);
    return;
  }

  const overflowCount = getOverflowItemIds(actor).length;
  if (overflowCount > 0) ensureOverflowToggleButton(app, root, overflowCount);
  else removeOverflowUI(root);
}

/* -------------------------------------------- */
/* Grit rules                                   */
/* -------------------------------------------- */

function getGritCapacity(actor) {
  const a = actor?.system ?? {};

  const vPrimary = Number(a.grit?.value);
  const vOther = Number(a.other?.grit?.value);

  let cap = 0;
  if (Number.isFinite(vOther) && vOther > 0) cap = vOther;
  else if (Number.isFinite(vPrimary) && vPrimary > 0) cap = vPrimary;

  return Math.max(0, Math.min(2, cap));
}

function getGritOccupiedCells(actor, excludeItemId = null) {
  const occ = new Set();

  for (const it of actor.items) {
    if (excludeItemId && it.id === excludeItemId) continue;

    const layout = it.getFlag(MODULE_ID, INV_FLAG_KEY);
    if (!layout?.cells) continue;

    if (layout.zone !== "grit") continue;
    if (it.type !== "condition") continue;
    if (isItemIncorrectPlacement(it)) continue;

    for (const cid of layout.cells) {
      if (String(cid).startsWith("grit:")) occ.add(cid);
    }
  }

  return occ;
}

function chooseAutoGritPlacement(actor, excludeItemId = null) {
  const cap = getGritCapacity(actor);
  if (cap <= 0) return null;

  const occ = getGritOccupiedCells(actor, excludeItemId);
  const slots = ["grit:1", "grit:2"].slice(0, cap);

  for (const s of slots) {
    if (!occ.has(s)) return { zone: "grit", cells: [s] };
  }

  return null;
}

function getOccupiedCells(actor, excludeItemId = null) {
  const occ = new Set();
  for (const it of actor.items) {
    if (excludeItemId && it.id === excludeItemId) continue;
    const layout = it.getFlag(MODULE_ID, INV_FLAG_KEY);
    if (!layout?.cells) continue;
    for (const cid of layout.cells) occ.add(cid);
  }
  return occ;
}

/* -------------------------------------------- */
/* Invalid markers                              */
/* -------------------------------------------- */

function isItemIncorrectPlacement(item) {
  return !!item.getFlag(MODULE_ID, INVALID_PLACEMENT_FLAG);
}

function refreshInvalidMarkers(app, root) {
  const actor = app?.actor;
  if (!actor) return;
  if (!safeGetSetting("core.inventoryLayout.enabled", true)) return;

  const profile = getInventoryProfile(getActorInventoryType(actor));

  const itemCards = Array.from(root.querySelectorAll(".item-card[data-item-id]"));
  for (const el of itemCards) {
    const itemId = el.dataset.itemId;
    const item = actor.items.get(itemId);
    if (!item) continue;

    const layout = item.getFlag(MODULE_ID, INV_FLAG_KEY);

    if (isItemIncorrectPlacement(item)) {
      const msg = item.getFlag(MODULE_ID, "invalidPlacementReason") || "Incorrect placement.";
      markInvalid(el, msg);
      continue;
    }

    if (!layout) {
      clearInvalidMark(el);
      continue;
    }

    let reason = null;

    if (profile.invType === "storage") {
      if (item.type === "condition") reason = game.i18n.localize("MRQOL.Inventory.StorageNoConditions");
      else if (layout.zone !== "pack") reason = game.i18n.localize("MRQOL.Inventory.InvalidZone");
    } else {
      if (item.type === "condition") {
        const allowed = profile.rules.hasGrit ? ["pack", "grit", OVERFLOW_ZONE] : ["pack", OVERFLOW_ZONE];
        if (!allowed.includes(layout.zone)) reason = game.i18n.localize("MRQOL.Inventory.InvalidConditionZone");
      }
      if (layout.zone === "grit" && item.type !== "condition") {
        reason = game.i18n.localize("MRQOL.Inventory.OnlyConditionsInGrit");
      }
    }

    if (reason) {
      markInvalid(el, reason);
      item.setFlag(MODULE_ID, "invalidPlacementReason", reason).catch(() => {});
      item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, true).catch(() => {});
      continue;
    }

    item.unsetFlag?.(MODULE_ID, "invalidPlacementReason")?.catch?.(() => {});
    clearInvalidMark(el);
  }
}

/* -------------------------------------------- */
/* Main: apply from DOM on drag end             */
/* -------------------------------------------- */

async function applyInventoryLayoutFromDOM(app, root, itemId) {
  const actor = app?.actor;
  if (!actor) return;

  const map = buildInventoryCells(root, actor);
  if (!map) return;

  const profile = map.profile ?? getInventoryProfile(getActorInventoryType(actor));
  const item = actor.items.get(itemId);
  if (!item) return;

  if (!safeGetSetting("core.inventoryLayout.enabled", true)) return;

  const safeId = globalThis.CSS?.escape ? CSS.escape(itemId) : itemId;
  let itemEl = root.querySelector(`.item-card[data-item-id="${safeId}"]`);
  if (!itemEl) itemEl = root.querySelector(`[data-item-id="${safeId}"]`);
  if (!itemEl) {
  // If the element isn't in DOM yet, try again next frame
  afterTwoFrames(() => applyInventoryLayoutFromDOM(app, root, itemId));
  return;
}

  const strict = safeGetSetting("core.inventoryLayout.strict", true);
  const threshold = Number(safeGetSetting("core.inventoryLayout.threshold", 0.35));
  const snap = safeGetSetting("core.inventoryLayout.snap", true);

  const strictEffective = profile.invType === "storage" ? true : strict;

  const itemRect = rectFromEl(itemEl);
  const { w, h, rotation } = getItemFootprint(item);

  const occupied = strictEffective ? buildOccupiedSet(actor, itemId) : null;
  let found = findBestPlacement(item, itemRect, w, h, map, { threshold, strict: strictEffective, occupied });

// --- SNAP POLICY ---
// Snap to first free slot in the zone the user dropped into.
// If invalid/blocked/full -> fallback to Pack -> Overflow.
{
  const occupied = buildOccupiedSet(actor, itemId);
  const wantedZone = found?.placement?.zone ?? null;

  // If the user dropped into some zone, snap within that zone first
  if (wantedZone) {
    // If zone is not allowed for this item, treat as invalid -> fallback.
    const allowed = isZoneAllowedForItem(item, wantedZone, map?.profile ?? null);

    if (allowed) {
      const preferredAnchorId = found?.anchor?.id ?? null;
	  const snapped = chooseAutoPlacementInZonePreferAnchor(item, map, wantedZone, occupied, preferredAnchorId);
      if (snapped) {
        found = { anchor: snapped.anchor, placement: snapped.placement, area: found?.area ?? 0 };
      } else {
        // zone full -> fallback below
        found = null;
      }
    } else {
      found = null;
    }
  }

  // Fallback: Pack
  if (!found) {
    const snappedPack = chooseAutoPackPlacementByOccupied(item, map, occupied);
    if (snappedPack) {
      found = { anchor: snappedPack.anchor, placement: snappedPack.placement, area: 0 };
    } else if (isOverflowSupported(actor) && !isItemPilesActor(actor)) {
      await moveItemToOverflowAuto(item);
      openOverflowWindow(actor);
      refreshInvalidMarkers(app, root);
      await refreshEncumbered(actor);
      return;
    }
  }
}

  // Storage: reject invalid placement
  if (!found && profile.invType === "storage") {
    ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.Full"));
    scheduleActorSheetRefresh(actor);
    return;
  }

  if (!found) {
    const reason =
      item.type === "condition"
        ? "Invalid placement: Conditions must be in Pack or Grit."
        : "Invalid placement: drop into a valid slot.";
    markInvalid(itemEl, reason);
    try {
      await item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, true);
      await item.setFlag(MODULE_ID, "invalidPlacementReason", reason).catch(() => {});
    } catch (_) {}

    refreshInvalidMarkers(app, root);
    await refreshEncumbered(actor);
    return;
  }

  // Enforce Grit rules
  if (found?.placement?.zone === "grit") {
    if (item.type !== "condition") {
      const reason = "Invalid placement: Only Conditions can be stored in Grit.";
      markInvalid(itemEl, reason);
      try {
        await item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, true);
        await item.setFlag(MODULE_ID, "invalidPlacementReason", reason).catch(() => {});
      } catch (_) {}

      refreshInvalidMarkers(app, root);
      await refreshEncumbered(actor);
      return;
    }

    const cap = getGritCapacity(actor);
    const occ = getGritOccupiedCells(actor, itemId);
    const anchorId = found?.anchor?.id;

    let pref = null;

    if (anchorId?.startsWith("grit:")) {
      const n = Number(anchorId.split(":")[1]);
      if (Number.isFinite(n) && n >= 1 && n <= Math.min(2, cap) && !occ.has(anchorId)) {
        pref = { zone: "grit", cells: [anchorId] };
      }
    }

    if (!pref) pref = chooseAutoGritPlacement(actor, itemId);

    if (!pref) {
      // No grit slots -> try pack; if pack full -> overflow
      const counts = getPackCellCounts(actor, itemId);
      const auto = chooseAutoPackPlacement(item, w, h, map, counts);
      if (auto) found = { anchor: auto.anchor, placement: auto.placement, area: found.area };
      else if (isOverflowSupported(actor) && !isItemPilesActor(actor)) {
        await moveItemToOverflowAuto(item);
        openOverflowWindow(actor);
        refreshInvalidMarkers(app, root);
        await refreshEncumbered(actor);
        return;
      } else {
        const reason = "No space: Pack auto-placement failed.";
        markInvalid(itemEl, reason);
        await item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, true).catch(() => {});
        await item.setFlag(MODULE_ID, "invalidPlacementReason", reason).catch(() => {});
        refreshInvalidMarkers(app, root);
        await refreshEncumbered(actor);
        return;
      }
    } else {
      found = { anchor: found.anchor, placement: pref, area: found.area };
    }
  }

  clearInvalidMark(itemEl);

  const { anchor, placement } = found;
  const zone = placement.zone;
  const cells = placement.cells;

  const prevLayout = item.getFlag(MODULE_ID, INV_FLAG_KEY);
  const same =
    prevLayout &&
    prevLayout.zone === zone &&
    prevLayout.w === w &&
    prevLayout.h === h &&
    prevLayout.rotation === rotation &&
    Array.isArray(prevLayout.cells) &&
    prevLayout.cells.length === cells.length &&
    prevLayout.cells.every((v, i) => v === cells[i]);

  if (same) {
    refreshInvalidMarkers(app, root);
    await refreshEncumbered(actor);
    return;
  }

  let updateData = {
    [`flags.${MODULE_ID}.${INV_FLAG_KEY}`]: { zone, cells, w, h, rotation },
    [`flags.${MODULE_ID}.${INVALID_PLACEMENT_FLAG}`]: false
  };

  // SNAP: write 6 fields consistently when possible
  if (snap) {
    const anchorId = anchor?.id ?? placement?.cells?.[0];
    const base = map?.slotPosByCellId?.[anchorId];

    if (base && Number.isFinite(base.x) && Number.isFinite(base.y)) {
      const cellW = Number(map?.cellWInv ?? 0) || 0;
      const cellH = Number(map?.cellHInv ?? 0) || 0;

      const offX = cellW ? ((w - 1) * cellW) / 2 : 0;
      const offY = cellH ? ((h - 1) * cellH) / 2 : 0;

      const newX = base.x + offX;
      const newY = base.y + offY;

      updateData = {
        ...updateData,
        "system.sheet.currentX": newX,
        "system.sheet.currentY": newY,
        "system.sheet.xOffset": newX,
        "system.sheet.yOffset": newY,
        "system.sheet.initialX": newX,
        "system.sheet.initialY": newY
      };
    }
  }

  // Derived flags
  if (profile.invType === "character") {
    if (item.type === "condition") updateData[`flags.${MODULE_ID}.${GRIT_ACTIVE_FLAG}`] = zone === "grit";
    else if (item.type === "weapon" || item.type === "armor" || isAmmo(item))
      updateData[`flags.${MODULE_ID}.${EQUIPPED_FLAG}`] = item.type === "weapon" ? zone === "carried" : zone === "worn";
  } else {
    updateData[`flags.${MODULE_ID}.${EQUIPPED_FLAG}`] = false;
    updateData[`flags.${MODULE_ID}.${GRIT_ACTIVE_FLAG}`] = false;
  }

  await item.update(updateData).catch(() => {});

  refreshInvalidMarkers(app, root);
  await refreshEncumbered(actor);
}

/* -------------------------------------------- */
/* Debounced sheet refresh                      */
/* -------------------------------------------- */

const __mrqolActorRefreshTimers = new Map();

function scheduleActorSheetRefresh(actor) {
  if (!actor) return;

  const key = actor.uuid ?? actor.id;
  if (__mrqolActorRefreshTimers.has(key)) return;

  const t = setTimeout(async () => {
    __mrqolActorRefreshTimers.delete(key);

    try {
      const entries = getOpenActorSheetRoots(actor.id);
      const renders = entries.map(({ app }) => {
        try {
          return app?.render?.(false);
        } catch (_) {
          return null;
        }
      });

      await Promise.allSettled(renders.filter(Boolean));

      afterTwoFrames(() => {
        refreshInventoryUIForActor(actor).catch(() => {});
      });
    } catch (_) {}
  }, 0);

  __mrqolActorRefreshTimers.set(key, t);
}

function getOverflowItems(actor) {
  return actor.items.filter((it) => {
    const cells = it.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? [];
    return Array.isArray(cells) && cells.some((c) => String(c).startsWith(`${OVERFLOW_ZONE}:`));
  });
}

/**
 * Choose the first valid Pack placement using OCCUPIED cells (supports multi-cell items).
 * @param {Item} item
 * @param {ReturnType<typeof buildInventoryCells>} map
 * @param {Set<string>} occupied
 */
function chooseAutoPackPlacementByOccupied(item, map, occupied) {
  const { w, h } = getItemFootprint(item);
  const packCount = Number(map?.pack?.count ?? 0) || 0;
  if (!packCount) return null;

  for (let start = 1; start <= packCount; start++) {
    const anchor = map.cells.find((c) => c.id === `pack:${start}`);
    if (!anchor) continue;

    const placement = getPlacementForAnchor(item, anchor, w, h, map);
    if (!placement || placement.zone !== "pack") continue;

    if (isPlacementBlocked(placement, occupied, map?.profile)) continue;
    return { anchor, placement };
  }

  return null;
}

function listZoneAnchors(map, zone) {
  if (!map) return [];
  const ids = map.cells.filter((c) => c.zone === zone).map((c) => c.id);

  // Define explicit ordering for special zones
  if (zone === "carried") return ["carried:main", "carried:off"].filter((x) => ids.includes(x));
  if (zone === "worn") return ["worn:top", "worn:bottom"].filter((x) => ids.includes(x));
  if (zone === "grit") return ["grit:1", "grit:2"].filter((x) => ids.includes(x));
  if (zone === "bank") return ["bank:1", "bank:2", "bank:3"].filter((x) => ids.includes(x));

  // Pack order
  if (zone === "pack") {
    const out = [];
    for (let i = 1; i <= (map.pack?.count ?? 0); i++) out.push(`pack:${i}`);
    return out.filter((x) => ids.includes(x));
  }

  return ids;
}

/**
 * Choose first placement in the given zone by anchor order.
 * Supports multi-cell items (uses getPlacementForAnchor).
 */
function chooseAutoPlacementInZone(item, map, zone, occupied) {
  const { w, h } = getItemFootprint(item);
  const anchors = listZoneAnchors(map, zone);

  for (const aid of anchors) {
    const anchor = map.cells.find((c) => c.id === aid);
    if (!anchor) continue;

    const placement = getPlacementForAnchor(item, anchor, w, h, map);
    if (!placement) continue;
    if (placement.zone !== zone) continue;
    if (isPlacementBlocked(placement, occupied, map?.profile)) continue;

    return { anchor, placement };
  }

  return null;
}

function chooseAutoPlacementInZonePreferAnchor(item, map, zone, occupied, preferredAnchorId = null) {
  const { w, h } = getItemFootprint(item);

  // 1) Try preferred anchor first (where the user actually dropped)
  if (preferredAnchorId) {
    const anchor = map.cells.find((c) => c.id === preferredAnchorId && c.zone === zone);
    if (anchor) {
      const placement = getPlacementForAnchor(item, anchor, w, h, map);
      if (placement && placement.zone === zone && !isPlacementBlocked(placement, occupied, map?.profile)) {
        return { anchor, placement };
      }
    }
  }

  // 2) Fall back to “first free in order”
  return chooseAutoPlacementInZone(item, map, zone, occupied);
}

/**
 * Pull items from Overflow back into Pack whenever Pack has free space.
 * Handles multi-cell items.
 * @param {Actor} actor
 */
async function rebalanceOverflowToPack(actor) {
  if (!actor) return;
  if (!safeGetSetting("core.inventoryLayout.enabled", true)) return;
  if (!isOverflowSupported(actor) || isItemPilesActor(actor)) return;

  const entries = getOpenActorSheetRoots(actor.id);
  const first = entries[0];
  if (!first?.root) return;

  const map = buildInventoryCells(first.root, actor);
  if (!map) return;

  const overflowItems = getOverflowItems(actor);

  if (!overflowItems.length) {
    await refreshEncumbered(actor);
    closeOverflowWindow(actor);
    return;
  }

  // Sort by lowest overflow index (stable)
  overflowItems.sort((a, b) => {
    const ca = (a.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? []).find((c) => String(c).startsWith(`${OVERFLOW_ZONE}:`)) ?? "";
    const cb = (b.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? []).find((c) => String(c).startsWith(`${OVERFLOW_ZONE}:`)) ?? "";
    const na = Number(String(ca).split(":")[1]) || 999999;
    const nb = Number(String(cb).split(":")[1]) || 999999;
    return na - nb || String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });

  // Try to move as many as possible
  for (let safety = 0; safety < 50; safety++) {
    let moved = false;

    for (const it of overflowItems) {
      // still in overflow?
      const cells = it.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? [];
      const stillOverflow = Array.isArray(cells) && cells.some((c) => String(c).startsWith(`${OVERFLOW_ZONE}:`));
      if (!stillOverflow) continue;

      // occupied excluding this item
      const occupied = buildOccupiedSet(actor, it.id);
      const res = chooseAutoPackPlacementByOccupied(it, map, occupied);

      if (res) {
        await moveItemToPlacement(it, res.placement, map, res.anchor.id);
        moved = true;
        break; // recompute occupied and try again
      }
    }

    if (!moved) break;
  }

  refreshInventoryUIForActor(actor).catch(() => {});
  await refreshEncumbered(actor);
  if (!actorHasOverflow(actor)) closeOverflowWindow(actor);
}

/* -------------------------------------------- */
/* Helpers: actor sheet roots                   */
/* -------------------------------------------- */

function getOpenActorSheetRoots(actorId) {
  const roots = [];
  for (const w of Object.values(ui.windows ?? {})) {
    const a = w?.actor;
    if (!a || a.id !== actorId) continue;
    const root = w?.element?.[0] ?? w?.element;
    if (!root) continue;
    if (!root.querySelector?.("#drag-area")) continue;
    roots.push({ app: w, root });
  }
  return roots;
}

/* -------------------------------------------- */
/* Move helpers                                 */
/* -------------------------------------------- */

async function moveItemToPlacement(item, placement, map, anchorCellId = null) {
  const actor = item?.parent;
  if (!actor) return;

  const { w, h, rotation } = getItemFootprint(item);

  const anchorId = anchorCellId ?? placement.cells?.[0];
  const pos = map?.slotPosByCellId?.[anchorId];

  const updateData = {
    [`flags.${MODULE_ID}.${INV_FLAG_KEY}`]: { zone: placement.zone, cells: placement.cells, w, h, rotation },
    [`flags.${MODULE_ID}.${INVALID_PLACEMENT_FLAG}`]: false
  };

  const profile = map?.profile ?? getInventoryProfile(getActorInventoryType(actor));

  if (profile.invType === "character") {
    if (item.type === "condition") {
      updateData[`flags.${MODULE_ID}.${GRIT_ACTIVE_FLAG}`] = placement.zone === "grit";
      updateData[`flags.${MODULE_ID}.${EQUIPPED_FLAG}`] = false;
    } else if (item.type === "weapon" || item.type === "armor" || isAmmo(item)) {
      updateData[`flags.${MODULE_ID}.${EQUIPPED_FLAG}`] = item.type === "weapon" ? placement.zone === "carried" : placement.zone === "worn";
      updateData[`flags.${MODULE_ID}.${GRIT_ACTIVE_FLAG}`] = false;
    }
  } else {
    updateData[`flags.${MODULE_ID}.${EQUIPPED_FLAG}`] = false;
    updateData[`flags.${MODULE_ID}.${GRIT_ACTIVE_FLAG}`] = false;
  }

  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    const cellW = Number(map?.cellWInv ?? 0) || 0;
    const cellH = Number(map?.cellHInv ?? 0) || 0;

    const offX = cellW ? ((w - 1) * cellW) / 2 : 0;
    const offY = cellH ? ((h - 1) * cellH) / 2 : 0;

    const nx = pos.x + offX;
    const ny = pos.y + offY;

    updateData["system.sheet.currentX"] = nx;
    updateData["system.sheet.currentY"] = ny;
    updateData["system.sheet.xOffset"] = nx;
    updateData["system.sheet.yOffset"] = ny;
    updateData["system.sheet.initialX"] = nx;
    updateData["system.sheet.initialY"] = ny;
  }

  await item.update(updateData).catch(() => {});
  scheduleActorSheetRefresh(actor);
}

/* -------------------------------------------- */
/* Utility: Reorder inventory (Pack only)       */
/* -------------------------------------------- */

function getCellById(map, id) {
  return map?.cells?.find((c) => c.id === id) ?? null;
}

export async function mrqolReorderInventoryForActorSheet(actor) {
  const sheet = actor?.sheet;
  if (!actor || !sheet) return;

  const currentRoot = sheet?.element?.[0] ?? sheet?.element;
  if (currentRoot?.querySelector) {
    await reorderInventory(actor, currentRoot);
    return;
  }

  const rootEl = await new Promise((resolve) => {
    let done = false;

    const finish = (el) => {
      if (done) return;
      done = true;

      clearTimeout(timeoutId);
      try {
        Hooks.off("renderActorSheet", hookV1);
      } catch (_) {}
      try {
        Hooks.off("renderActorSheetV2", hookV2);
      } catch (_) {}

      resolve(el);
    };

    const onRender = (app, html) => {
      if (app !== sheet) return;

      const el = html?.[0] ?? html ?? sheet?.element?.[0] ?? sheet?.element ?? null;
      finish(el instanceof HTMLElement ? el : null);
    };

    const hookV1 = Hooks.on("renderActorSheet", onRender);
    const hookV2 = Hooks.on("renderActorSheetV2", onRender);

    const timeoutId = setTimeout(() => {
      const fallback = sheet?.element?.[0] ?? sheet?.element ?? null;
      finish(fallback instanceof HTMLElement ? fallback : null);
    }, 1000);

    sheet.render(true);
  });

  if (!rootEl || typeof rootEl.querySelector !== "function") {
    console.warn(`${MODULE_ID} | Reorder skipped: sheet root is not an HTMLElement.`, { rootEl, sheet });
    return;
  }

  await reorderInventory(actor, rootEl);
}

async function reorderInventory(actor, root) {
  if (!actor || !root) return;
  if (!safeGetSetting("core.inventoryLayout.enabled", true)) return;

  const map = buildInventoryCells(root, actor);
  if (!map) return;

  const profile = map.profile ?? getInventoryProfile(getActorInventoryType(actor));

  const items = actor.items.filter((it) => !(profile.invType === "storage" && it.type === "condition"));

  items.sort((a, b) => {
    const fa = getItemFootprint(a);
    const fb = getItemFootprint(b);
    const aa = fa.w * fa.h;
    const bb = fb.w * fb.h;
    if (bb !== aa) return bb - aa;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });

  const occupied = new Set();
  const packAnchors = Array.from({ length: map.pack.count }, (_, i) => `pack:${i + 1}`);

  const tryAnchors = (item, anchorIds) => {
    const { w, h } = getItemFootprint(item);
    for (const aid of anchorIds) {
      const cell = getCellById(map, aid);
      if (!cell) continue;
      const placement = getPlacementForAnchor(item, cell, w, h, map);
      if (!placement) continue;
      if (isPlacementBlocked(placement, occupied, profile)) continue;
      return { placement, anchorId: aid };
    }
    return null;
  };

  for (const it of items) {
    // Never auto-place overflow items into Pack unless user removes overflow manually
    const inOverflow = (it.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? []).some((c) => String(c).startsWith(`${OVERFLOW_ZONE}:`));
    if (inOverflow) continue;

    let preferred = [...packAnchors];
    if (profile.invType === "character") {
      if (it.type === "condition") preferred = profile.rules.hasGrit ? ["grit:1", "grit:2", ...packAnchors] : [...packAnchors];
      else if (it.type === "weapon") preferred = ["carried:main", "carried:off", ...packAnchors];
      else if (it.type === "armor" || isAmmo(it)) preferred = ["worn:top", "worn:bottom", ...packAnchors];
    } else if (profile.invType !== "storage") {
      if (it.type === "weapon") preferred = ["carried:main", "carried:off", ...packAnchors];
    }

    const res = tryAnchors(it, preferred);
    if (!res) continue;

    for (const cid of res.placement.cells) occupied.add(String(cid));
    await moveItemToPlacement(it, res.placement, map, res.anchorId);
  }

  refreshInventoryUIForActor(actor).catch(() => {});
  await refreshEncumbered(actor);
}

/* -------------------------------------------- */
/* Equip toggles + movement                      */
/* -------------------------------------------- */

/**
 * Usage state indicator for items with usage pips.
 * - Weapons / Armour: show Broken when fully marked.
 * - Other items (including spells, gear, ammo): show Empty when fully marked.
 * @param {Item} item
 * @returns {{src:string, title:string}|null}
 */
function getUsageStateIcon(item) {
  const max = Number(item?.system?.pips?.max ?? 0) || 0;
  const val = Number(item?.system?.pips?.value ?? 0) || 0;
  if (!max) return null;
  if (val < max) return null;

  const isBreakable = item.type === "weapon" || item.type === "armor";
  const src = isBreakable ? BROKEN_ICON : EMPTY_ICON;
  const titleKey = isBreakable ? "MRQOL.Pips.State.Broken" : "MRQOL.Pips.State.Empty";
  const title = game.i18n?.has?.(titleKey) ? game.i18n.localize(titleKey) : (isBreakable ? "Broken" : "Empty");
  return { src, title };
}

function isAmmo(item) {
  const tag = item?.system?.tag ?? item?.system?.category ?? "";
  return String(tag).toLowerCase() === "ammunition";
}

function isItemEquipped(item) {
  const layout = item?.getFlag?.(MODULE_ID, INV_FLAG_KEY);
  if (!layout) return false;

  const actor = item?.parent;
  const profile = actor ? getInventoryProfile(getActorInventoryType(actor)) : getInventoryProfile("character");

  if (profile.invType === "storage") return false;

  if (profile.invType === "character") {
    if (item.type === "weapon") return layout.zone === "carried";
    if (item.type === "spell") return layout.zone === "carried";
    if (item.type === "armor") return layout.zone === "worn";
    if (isAmmo(item)) return layout.zone === "worn";
    return false;
  }

  const manual = !!item.getFlag?.(MODULE_ID, "equippedManual");

  if (item.type === "weapon") {
    if (layout.zone === "carried") return true;
    return profile.invType === "creature" ? manual : false;
  }

  if (item.type === "spell") {
  // For non-character inventories, treat spells like weapons: equipped if in carried
  if (layout.zone === "carried") return true;
  return false;
}

  if (item.type === "armor" || isAmmo(item)) return manual;

  return false;
}

function isEquippedByLayout(item) {
  return isItemEquipped(item);
}

function isGritActiveByLayout(item) {
  const layout = item?.getFlag?.(MODULE_ID, INV_FLAG_KEY);
  const actor = item?.parent;
  const profile = actor ? getInventoryProfile(getActorInventoryType(actor)) : getInventoryProfile("character");
  if (!profile.rules.hasGrit) return false;
  return item?.type === "condition" && layout?.zone === "grit";
}

async function moveItemToPackAuto(item, map) {
  const actor = item.parent;
  const { w, h } = getItemFootprint(item);
  const occupied = buildOccupiedSet(actor, item.id);

  const counts = getPackCellCounts(actor, item.id);
  const autoPack = chooseAutoPackPlacement(item, w, h, map, counts);
  if (autoPack && !isPlacementBlocked(autoPack.placement, occupied, map?.profile)) {
    await moveItemToPlacement(item, autoPack.placement, map, autoPack.anchor.id);
    return true;
  }

  if (isOverflowSupported(actor) && !isItemPilesActor(actor)) {
    await moveItemToOverflowAuto(item);
    openOverflowWindow(actor);
    return true;
  }

  ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.Full"));
  return false;
}

async function equipItemToSlots(item, map) {
  const actor = item.parent;
  const profile = map?.profile ?? getInventoryProfile(getActorInventoryType(actor));
  const occ = getOccupiedCells(actor, item.id);
  const { w, h } = getItemFootprint(item);

  const tryAnchors = (anchorIds) => {
    for (const aid of anchorIds) {
      const cell = getCellById(map, aid);
      if (!cell) continue;
      const placement = getPlacementForAnchor(item, cell, w, h, map);
      if (!placement) continue;
      if (isPlacementBlocked(placement, occ, profile)) continue;
      return { placement, anchorId: aid };
    }
    return null;
  };

  if (profile.invType !== "character") {
    if (profile.invType === "storage") return false;

    if (item.type === "weapon") {
      const res = tryAnchors(["carried:main", "carried:off"]);
      if (res) {
        await moveItemToPlacement(item, res.placement, map, res.anchorId);
        return true;
      }
      if (profile.invType === "creature") return false;
      ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.NoSpaceEquipWeapon"));
      return false;
    }

    if (item.type === "spell") {
      const res = tryAnchors(["carried:main", "carried:off"]);
      if (res) {
        await moveItemToPlacement(item, res.placement, map, res.anchorId);
        return true;
      }
      if (profile.invType === "creature") return false;
      ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.NoSpaceEquipSpell"));
      return false;
    }    

    if (item.type === "armor" || isAmmo(item)) return moveItemToPackAuto(item, map);
    return false;
  }

  if (item.type === "weapon") {
    const res = tryAnchors(["carried:main", "carried:off"]);
    if (!res) {
      ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.NoSpaceEquipWeapon"));
      return false;
    }
    await moveItemToPlacement(item, res.placement, map, res.anchorId);
    return true;
  }

  if (item.type === "spell") {
    const res = tryAnchors(["carried:main", "carried:off"]);
    if (!res) {
      ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.NoSpaceEquipSpell"));
      return false;
    }
    await moveItemToPlacement(item, res.placement, map, res.anchorId);
    return true;
  }

  if (item.type === "armor") {
    if (w === 2 && h === 1) {
      const res = tryAnchors(["carried:off", "worn:bottom"]);
      if (!res) {
        ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.NoSpaceEquipArmor"));
        return false;
      }
      await moveItemToPlacement(item, res.placement, map, res.anchorId);
      return true;
    }

    if (w === 1 && h === 2) {
      const res = tryAnchors(["worn:top", "worn:bottom"]);
      if (!res) {
        ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.NoSpaceEquipArmor"));
        return false;
      }
      await moveItemToPlacement(item, res.placement, map, res.anchorId);
      return true;
    }

    const res = tryAnchors(["worn:top", "worn:bottom"]);
    if (!res) {
      ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.NoSpaceEquipArmor"));
      return false;
    }
    await moveItemToPlacement(item, res.placement, map, res.anchorId);
    return true;
  }

  if (isAmmo(item)) {
    const res = tryAnchors(["worn:top", "worn:bottom"]);
    if (!res) {
      ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.NoSpaceEquipAmmunition"));
      return false;
    }
    await moveItemToPlacement(item, res.placement, map, res.anchorId);
    return true;
  }

  return false;
}

async function toggleEquipForItem(actor, itemId, map) {
  const item = actor.items.get(itemId);
  if (!item) return;
  if (item.type === "condition") return;

  const equipped = isEquippedByLayout(item);
  const profile = map?.profile ?? getInventoryProfile(getActorInventoryType(actor));
  const layout = item.getFlag(MODULE_ID, INV_FLAG_KEY);
  const invType = profile?.invType ?? getActorInventoryType(actor);

  if (invType === "storage") return;

  if ((invType === "creature" || invType === "hireling") && (item.type === "armor" || isAmmo(item))) {
    const next = !equipped;

    if (next && item.type === "armor") {
      const others = actor.items.filter((it) => it.type === "armor" && it.id !== item.id);
      for (const it of others) await it.setFlag(MODULE_ID, "equippedManual", false).catch(() => {});
    }

    await item.setFlag(MODULE_ID, "equippedManual", next).catch(() => {});
    refreshInventoryUIForActor(actor).catch(() => {});
    return;
  }

  if ((invType === "creature" || invType === "hireling") && item.type === "weapon") {
    if (layout?.zone === "carried") {
      await item.setFlag(MODULE_ID, "equippedManual", false).catch(() => {});
      await moveItemToPackAuto(item, map);
      return;
    }

    const moved = await equipItemToSlots(item, map);
    if (moved) {
      await item.setFlag(MODULE_ID, "equippedManual", false).catch(() => {});
      return;
    }

    if (invType === "creature") {
      await item.setFlag(MODULE_ID, "equippedManual", !equipped).catch(() => {});
      refreshInventoryUIForActor(actor).catch(() => {});
    }
    return;
  }

  if (equipped) await moveItemToPackAuto(item, map);
  else await equipItemToSlots(item, map);
}

async function toggleGritForCondition(actor, itemId, map) {
  const item = actor.items.get(itemId);
  if (!item || item.type !== "condition") return;

  const active = isGritActiveByLayout(item);
  if (active) {
    await moveItemToPackAuto(item, map);
    return;
  }

  const placement = chooseAutoGritPlacement(actor, itemId);
  if (!placement) {
    ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.NoSpaceEquipGrit"));
    return;
  }
  await moveItemToPlacement(item, placement, map, placement.cells[0]);
}

function refreshToggleButtonsForRoot(actor, root, { includeOverflow = false } = {}) {
  const profile = getInventoryProfile(getActorInventoryType(actor));
  const cards = Array.from(root.querySelectorAll(".item-card[data-item-id]"));

  for (const card of cards) {
    const itemId = card.dataset.itemId;
    const item = actor.items.get(itemId);
    if (!item) continue;

    const isOverflow = (item.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? []).some((c) =>
      String(c).startsWith(`${OVERFLOW_ZONE}:`)
    );
    if (isOverflow && !includeOverflow) continue;

    let toggles = card.querySelector(".mrqol-card-toggles");
    if (!toggles) {
      toggles = document.createElement("div");
      toggles.className = "mrqol-card-toggles";
      // en cards del sistema suele ir dentro del header, si existe:
      const header = card.querySelector(".item-card-header");
      (header ?? card).appendChild(toggles);
    }

    // limpia duplicados
    toggles.querySelectorAll(".mrqol-equip-toggle, .mrqol-grit-toggle").forEach((n) => n.remove());

        // Usage state indicator (Broken / Empty)
    const state = getUsageStateIcon(item);
    let badge = card.querySelector(".mrqol-usage-indicator");
    if (!state) {
      badge?.remove();
    } else {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "mrqol-usage-indicator";
        card.appendChild(badge);
      }
      // Tooltip
      badge.setAttribute("title", state.title);

      // Mask (no square edges)
      badge.style.webkitMaskImage = `url("${state.src}")`;
      badge.style.maskImage = `url("${state.src}")`;
    }

    // Equip toggle
    const needsEquip =
      profile.rules.allowEquip &&
      (item.type === "weapon" || item.type === "armor" || item.type === "spell" || isAmmo(item));

    if (needsEquip) {
      const btn = document.createElement("a");
      btn.className = "item-control mrqol-equip-toggle mrqol-toggle";
      btn.setAttribute("title", "Equip/Unequip");

      let iconClass = "fa-solid fa-shirt"; // default fallback

      // Icons by type/tag
      if (item.type === "armor") iconClass = "fa-solid fa-shield-halved";
      else if (item.type === "weapon") iconClass = "fa-solid fa-shirt";
      else if (isAmmo(item)) iconClass = "fa-solid fa-bow-arrow";
      else if (item.type === "spell") iconClass = "fa-solid fa-hand-sparkles";
      else if (item.type === "condition") iconClass = "fa-solid fa-bolt";

      btn.innerHTML = `<i class="${iconClass}"></i>`;
      btn.classList.toggle("mrqol-active", isEquippedByLayout(item));

btn.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  // 1) Normal sheet: build map from THIS root
  let map = buildInventoryCells(root, actor);

  // 2) Fallback: if this root is overflow window (no #drag-area), use any open sheet root
  if (!map) {
    const entries = getOpenActorSheetRoots(actor.id);
    const first = entries[0];
    if (!first?.root) return;
    map = buildInventoryCells(first.root, actor);
  }

  if (!map) return;
  toggleEquipForItem(actor, itemId, map).catch(() => {});
}, true);

      toggles.appendChild(btn);
    }

    // Grit toggle (solo en character con grit)
    if (profile.rules.hasGrit && item.type === "condition") {
      const btn = document.createElement("a");
      btn.className = "item-control mrqol-grit-toggle mrqol-toggle";
      btn.setAttribute("title", "Grit");
      btn.innerHTML = `<i class="fa-solid fa-bolt"></i>`;
      btn.classList.toggle("mrqol-active", isGritActiveByLayout(item));

btn.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  let map = buildInventoryCells(root, actor);

  if (!map) {
    const entries = getOpenActorSheetRoots(actor.id);
    const first = entries[0];
    if (!first?.root) return;
    map = buildInventoryCells(first.root, actor);
  }

  if (!map) return;
  toggleGritForCondition(actor, itemId, map).catch(() => {});
}, true);

      toggles.appendChild(btn);
    }
  }
}

function refreshToggleButtons(app, root) {
  const actor = app?.actor;
  if (!actor) return;
  refreshToggleButtonsForRoot(actor, root, { includeOverflow: false });
}

/* -------------------------------------------- */
/* Sheet <-> overflow window interoperability    */
/* -------------------------------------------- */

/**
 * When an overflow item is dragged from the overflow window onto the actor sheet,
 * we intercept the drop and attempt to place it into Pack automatically.
 */
function bindOverflowDropHandler(app, root) {
  if (root.dataset.mrqolOverflowDropHooked === "1") return;
  root.dataset.mrqolOverflowDropHooked = "1";

  root.addEventListener(
    "drop",
    async (ev) => {
      try {
        const raw = ev.dataTransfer?.getData?.("text/plain");
        if (!raw) return;

        let data;
        try { data = JSON.parse(raw); } catch (_) { return; }

        if (data?.type !== "Item" || !data?.uuid) return;

        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc || doc.documentName !== "Item") return;

        const actor = app?.actor;
        if (!actor || doc.parent?.id !== actor.id) return;

        const inOverflow = (doc.getFlag(MODULE_ID, INV_FLAG_KEY)?.cells ?? []).some((c) =>
          String(c).startsWith(`${OVERFLOW_ZONE}:`)
        );

        // If it was an overflow item, schedule a snap pass after Foundry/Mausritter applies the drop.
        if (inOverflow) {
          root.dataset.mrqolLastDraggedItemId = doc.id;
          afterTwoFrames(() => applyInventoryLayoutFromDOM(app, root, doc.id));
        }
      } catch (_) {}
    },
    true
  );
}

/* -------------------------------------------- */
/* Inventory UI refresh                          */
/* -------------------------------------------- */

async function refreshPackSlotTooltips(map, actor) {
  if (!map?.packSlotsByN) return;
  const counts = getPackCellCounts(actor);

  const packCount = Number(map?.pack?.count ?? 0) || 0;
  for (let n = 1; n <= packCount; n++) {
    const el = map.packSlotsByN[n];
    if (!el) continue;

    const c = counts[n] ?? 0;
    if (c >= 2) el.setAttribute("title", `Pack ${n}: ${c} items`);
    else el.removeAttribute("title");
  }
}

function refreshPackStackBadgesAndTooltips(app, root) {
  // Stacks are disabled; keep badge cleanup only.
  const itemCards = Array.from(root.querySelectorAll(".item-card[data-item-id]"));
  for (const el of itemCards) {
    delete el.dataset.mrqolStackTitle;
    clearStackBadge(el);
    applyItemTitle(el);
  }
}

async function refreshInventoryUIForActor(actor) {
  if (!actor) return;

  const entries = getOpenActorSheetRoots(actor.id);
  for (const { app, root } of entries) {
    ensureOverflowUI(app, root);
    bindOverflowDropHandler(app, root);

    const map = buildInventoryCells(root, actor);

    refreshToggleButtons(app, root);
    refreshInvalidMarkers(app, root);
    refreshPackStackBadgesAndTooltips(app, root);
    if (map) await refreshPackSlotTooltips(map, actor);
  }

  await refreshEncumbered(actor);

  // Auto-close overflow window if empty
  if (!actorHasOverflow(actor)) closeOverflowWindow(actor);
}

/* -------------------------------------------- */
/* Inventory DOM observer                        */
/* -------------------------------------------- */

const __mrqolInvObserversByApp = new WeakMap();

function ensureInventoryObserver(app, root) {
  if (!app?.actor || !root?.querySelector) return;

  const existing = __mrqolInvObserversByApp.get(app);
  if (existing) {
    existing.root = root;
    existing.observeRoot();
    existing.rebindDragArea();
    return;
  }

  const state = {
    app,
    root,
    dragObs: null,
    rootObs: null,
    dragEl: null,
    timer: null,
    closeHooks: []
  };

  const schedule = () => {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      try {
        refreshInventoryUIForActor(app.actor).catch(() => {});
      } catch (_) {}
    }, 0);
  };

  const bindToDragArea = () => {
    const nextDrag = state.root?.querySelector?.("#drag-area") ?? null;
    if (!nextDrag) return;

    if (state.dragEl === nextDrag && state.dragObs) return;

    try {
      state.dragObs?.disconnect();
    } catch (_) {}
    state.dragObs = null;
    state.dragEl = nextDrag;

    state.dragObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList" && (m.addedNodes.length || m.removedNodes.length)) {
          schedule();
          return;
        }
        if (m.type === "attributes") {
          schedule();
          return;
        }
      }
    });

    state.dragObs.observe(nextDrag, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-item-id", "class"]
    });

    schedule();
  };

  const observeRoot = () => {
    try {
      state.rootObs?.disconnect();
    } catch (_) {}

    state.rootObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList" && (m.addedNodes.length || m.removedNodes.length)) {
          bindToDragArea();
          return;
        }
      }
    });

    state.rootObs.observe(state.root, {
      childList: true,
      subtree: true
    });
  };

  state.rebindDragArea = bindToDragArea;
  state.observeRoot = observeRoot;

  observeRoot();
  bindToDragArea();

  const cleanup = (closingApp) => {
    if (closingApp !== app) return;

    for (const hook of state.closeHooks) {
      try {
        Hooks.off(hook.event, hook.id);
      } catch (_) {}
    }
    state.closeHooks = [];

    try {
      state.dragObs?.disconnect();
    } catch (_) {}
    try {
      state.rootObs?.disconnect();
    } catch (_) {}

    if (state.timer) clearTimeout(state.timer);

    __mrqolInvObserversByApp.delete(app);
  };

  state.closeHooks = [
    { event: "closeActorSheet", id: Hooks.on("closeActorSheet", cleanup) },
    { event: "closeActorSheetV2", id: Hooks.on("closeActorSheetV2", cleanup) }
  ];

  __mrqolInvObserversByApp.set(app, state);
}

/* -------------------------------------------- */
/* Sheet hook registration                      */
/* -------------------------------------------- */

function registerInventoryLayoutOnActorSheet(app, html) {
  const enabled = safeGetSetting("core.inventoryLayout.enabled", true);
  if (!enabled) return;

  const root = getRootElement(app, html);
  if (!root) return;
  if (!root.querySelector("#drag-area")) return;

  bindRollContext(app, root);
  ensureInventoryObserver(app, root);

  if (root.dataset.mrqolInvLayoutHooked === "1") return;
  root.dataset.mrqolInvLayoutHooked = "1";

  refreshInventoryUIForActor(app.actor).catch(() => {});

  root.addEventListener(
    "dragstart",
    (ev) => {
      const card = ev.target?.closest?.(".item-card[data-item-id]") ?? ev.target?.closest?.("[data-item-id]");
      const itemId = card?.dataset?.itemId;
      if (itemId) root.dataset.mrqolLastDraggedItemId = itemId;
    },
    true
  );

  root.addEventListener(
    "dragend",
    () => {
      const itemId = root.dataset.mrqolLastDraggedItemId;
      if (!itemId) return;
      afterTwoFrames(() => applyInventoryLayoutFromDOM(app, root, itemId));
    },
    true
  );
}

/* -------------------------------------------- */
/* Reactive hooks                                */
/* -------------------------------------------- */

function registerInventoryReactiveHooks() {
  Hooks.on("createItem", (item) => {
    const actor = item?.parent;
    if (actor?.documentName !== "Actor") return;

    afterTwoFrames(async () => {
      try {
        if (!safeGetSetting("core.inventoryLayout.enabled", true)) return;

        const hasLayout = !!item.getFlag(MODULE_ID, INV_FLAG_KEY);
        if (hasLayout) return;

        const entries = getOpenActorSheetRoots(actor.id);
        const first = entries[0];
        if (!first) return;

        const map = buildInventoryCells(first.root, actor);
        if (!map) return;

        await moveItemToPackAuto(item, map);
      } catch (e) {
        console.warn(`${MODULE_ID} | createItem auto-place failed`, e);
      } finally {
        await rebalanceOverflowToPack(actor).catch(() => {});
		refreshInventoryUIForActor(actor).catch(() => {});
      }
    });
  });

  Hooks.on("updateItem", (item, change) => {
    const actor = item?.parent;
    if (actor?.documentName !== "Actor") return;

    const affectsLayout =
      change?.flags?.[MODULE_ID]?.[INV_FLAG_KEY] != null || change?.system?.sheet != null || change?.system?.size != null;

    if (!affectsLayout) return;

    afterTwoFrames(async () => {
    await rebalanceOverflowToPack(actor).catch(() => {});
});
	refreshInventoryUIForActor(actor).catch(() => {});
  });

  Hooks.on("preDeleteItem", (item) => {
    const actor = item?.parent;
    if (actor?.documentName !== "Actor") return;

    afterTwoFrames(async () => {
    await rebalanceOverflowToPack(actor).catch(() => {});
  });
	refreshInventoryUIForActor(actor).catch(() => {});
  });

  Hooks.on("updateActor", (actor, change) => {
    if (actor?.documentName !== "Actor") return;
    const gritChanged = change?.system?.grit != null || change?.system?.other?.grit != null;
    if (gritChanged) refreshInventoryUIForActor(actor).catch(() => {});
  });

  Hooks.on("updateToken", (tokenDoc, change) => {
    if (!tokenDoc?.actor) return;
    if (change?.effects != null || change?.statuses != null) enforceEncumberedOnTokenUpdate(tokenDoc);
  });

  // Storage-specific validation
  Hooks.on("preCreateItem", (item, data) => {
    const actor = item?.parent;
    if (!actor || actor.documentName !== "Actor") return;

    const profile = getInventoryProfile(getActorInventoryType(actor));
    if (profile.invType !== "storage") return;
    if (!safeGetSetting("core.inventoryLayout.enabled", true)) return;

    const type = String(data?.type ?? item?.type ?? "");
    if (type === "condition") {
      ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.StorageNoConditions"));
      return false;
    }

    const cols = Math.max(0, Math.floor(Number(actor?.system?.size?.width ?? 0) || 0));
    const rows = Math.max(0, Math.floor(Number(actor?.system?.size?.height ?? 0) || 0));
    const count = cols * rows;
    if (!count) return;

    const { w, h } = getFootprintFromItemData(data);
    if (w < 1 || h < 1) return;
    if (w > cols || h > rows) {
      ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.StorageTooSmall"));
      return false;
    }

    const occupied = buildOccupiedSet(actor, null);

    const fitsAt = (start) => {
      const idx = start - 1;
      const c0 = idx % cols;
      const r0 = Math.floor(idx / cols);
      if (c0 + w > cols) return false;
      if (r0 + h > rows) return false;

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const n = r0 * cols + c0 + dx + 1 + dy * cols;
          const cid = `pack:${n}`;
          if (occupied.has(cid)) return false;
        }
      }
      return true;
    };

    let ok = false;
    for (let start = 1; start <= count; start++) {
      if (fitsAt(start)) {
        ok = true;
        break;
      }
    }

    if (!ok) {
      ui.notifications?.warn?.(game.i18n.localize("MRQOL.Inventory.Full"));
      return false;
    }
  });
}

/* -------------------------------------------- */
/* Pack definition                              */
/* -------------------------------------------- */

export const CorePack = {
  id: "core",
  label: "Core QOL",
  description: "Stable, no dependencies.",
  defaultEnabled: true,

  init() {
    registerEncumberedStatusEffect();
    forceAdvantageDialogIfEncumbered();
    registerInventoryReactiveHooks();
    // Character Creator (Actors Directory button + wizard)
    registerCharacterCreator();

    // I18n sync buttons (Actor/Item sheets)
    registerI18nSyncButtons();    

    // Repairs
    Hooks.on("renderItemSheet", injectRepairsUI);
    Hooks.on("renderItemSheet", injectPipsStateToItemSheet);
    Hooks.on("getItemSheetHeaderButtons", addHeaderButtons);

    // Inventory layout
    Hooks.on("renderActorSheet", registerInventoryLayoutOnActorSheet);
    Hooks.on("renderActorSheetV2", registerInventoryLayoutOnActorSheet);

    // Optional tool: Reorder inventory
    Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
      const actor = app?.actor;
      if (!actor) return;
      if (!safeGetSetting("core.inventoryLayout.reorderButton", true)) return;

      buttons.unshift({
        label: game.i18n.localize("MRQOL.Inventory.Reorder"),
        class: "mrqol-reorder-inventory",
        icon: "fa-solid fa-arrow-rotate-right",
        onclick: async () => {
          const root = app?.element?.[0] ?? app?.element;
          if (!root) return;
          await reorderInventory(actor, root);
        }
      });
    });
  },

  ready() {}
};

PackManager.register(CorePack);