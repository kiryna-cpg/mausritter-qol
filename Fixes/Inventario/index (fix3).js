// 1. Ordenación de objetos:
// Rellena los huecos correctamente on dragdrop en Pack, Carried y Worn, pero no en Grit. Ocupa casillas libres al borrar siempre que sean objetos de una casilla.
// 2. Badges en objetos apilados (más de un objeto en una casilla).
// El badge numérico de objetos apilados aparece y desaparece (se muestra al abrir la ficha)
// 3. Status Effect Encumbered
// No activa automáticamente Encumbered cuando hay objetos apilados
// Encumbered se puede activar manualmente, pero no causa desventaja en las salvaciones
// Los objetos apilados fuerzan la desventaja en las salvaciones sin activar Encumbered.
4. Incorrect Placement
// No muestra el overlay de Incorrect placement
5. Equipar/Desequipar
// Los botones de Equipar/Desequipar aparecen correctamente cuando se abre la ficha y después desaparecen. Desequipar funciona en Armor y Weapon, pero Equipar no. El botón de Grit funciona en Conditions.
6. Grit
// No gestiona la zona Grit correctamente

import { PackManager } from "../../framework/packs.js";
import { MODULE_ID } from "../../framework/paths.js";
import { repairItem, getRepairQuote } from "./repairs.js";

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

  const item = getItemFromApp(app);
  if (!item?.actor) return;

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
/* Inventory Layout + Rules                     */
/* -------------------------------------------- */

const INV_FLAG_KEY = "layout";
const ENCUMBERED_ID = "encumbered";
const ENCUMBERED_ICON = `modules/${MODULE_ID}/assets/icons/encumbered.png`;
const INVALID_PLACEMENT_FLAG = "invalidPlacement";
const EQUIPPED_FLAG = "equipped";
const GRIT_ACTIVE_FLAG = "gritActive";

let __mrqolLastRollActorId = null;
const __mrqolEncInFlight = new Map();

function isItemPilesActor(actor) {
  try {
    if (actor?.type && String(actor.type).toLowerCase().includes("pile")) return true;
    const flags = actor?.flags ?? {};
    if (flags["item-piles"]) return true;
    if (actor?.getFlag?.("item-piles", "data") != null) return true;
    if (actor?.getFlag?.("item-piles", "itemPile") != null) return true;
  } catch (_) {}
  return false;
}

function safeGetSetting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch (_) {
    return fallback;
  }
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

/* -------------------------------------------- */
/* Status Effect: Encumbered                    */
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

async function setActorEncumbered(actor, active) {
  if (!actor) return;

  const exclude = safeGetSetting("core.inventoryLayout.encumbrance.excludeItemPiles", true);
  if (exclude && isItemPilesActor(actor)) return;

  const key = actor.uuid ?? actor.id;
  const prev = __mrqolEncInFlight.get(key) ?? Promise.resolve();

  const next = prev.finally(async () => {
    const existing = getEncumberedEffectIds(actor);

    if (active) {
      if (existing.length === 0) {
        if (typeof actor.toggleStatusEffect !== "function") {
          await actor.setFlag(MODULE_ID, "encumbered", true).catch(() => {});
        } else {
          try {
            await actor.toggleStatusEffect(ENCUMBERED_ID, { active: true });
          } catch (e) {
            console.warn(`${MODULE_ID} | Failed to apply Encumbered`, e);
          }
        }
      }

      if (typeof actor.deleteEmbeddedDocuments === "function") {
        const idsNow = getEncumberedEffectIds(actor);
        if (idsNow.length > 1) {
          const extras = idsNow.slice(1);
          try {
            await actor.deleteEmbeddedDocuments("ActiveEffect", extras);
          } catch (_) {}
        }
      }
      return;
    }

    await actor.setFlag(MODULE_ID, "encumbered", false).catch(() => {});
    const idsNow = getEncumberedEffectIds(actor);
    if (!idsNow.length) return;
    if (typeof actor.deleteEmbeddedDocuments !== "function") return;

    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", idsNow);
    } catch (e) {
      const msg = String(e?.message ?? "");
      if (!msg.includes("does not exist")) console.warn(`${MODULE_ID} | Failed to remove Encumbered`, e);
    }
  });

  __mrqolEncInFlight.set(key, next);
  try {
    await next;
  } finally {
    if (__mrqolEncInFlight.get(key) === next) __mrqolEncInFlight.delete(key);
  }
}

function getPackCellCounts(actor, excludeItemId = null) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
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

function isItemIncorrectPlacement(item) {
  return !!item.getFlag(MODULE_ID, INVALID_PLACEMENT_FLAG);
}

function getEffectivePackCellCounts(actor) {
  const counts = getPackCellCounts(actor);
  const extras = actor.items.filter((it) => {
    if (it.getFlag(MODULE_ID, INV_FLAG_KEY)?.zone === "pack") return false;
    return isItemIncorrectPlacement(it);
  });

  for (const _it of extras) {
    let best = 1;
    for (let n = 2; n <= 6; n++) {
      if ((counts[n] ?? 0) < (counts[best] ?? 0)) best = n;
    }
    counts[best] = (counts[best] ?? 0) + 1;
  }
  return counts;
}


const __mrqolPackRebalanceInFlight = new Map();

/**
 * PACK COMPACTION:
 * If there are empty Pack slots and some items are stacked (>=2) in any slot,
 * move items from stacked slots into the earliest available empty footprint,
 * so stacking only happens when Pack is truly full.
 */
async function rebalancePack(actor) {
  if (!actor) return;
  if (!safeGetSetting("core.inventoryLayout.enabled", true)) return;

  const key = actor.uuid ?? actor.id;
  const prev = __mrqolPackRebalanceInFlight.get(key) ?? Promise.resolve();

  const next = prev.finally(async () => {
    // Need a sheet root to compute slot positions in inventory-space
    const entries = getOpenActorSheetRoots(actor.id);
    const first = entries[0];
    if (!first) return;

    const map = buildInventoryCells(first.root);
    if (!map) return;

    // Hard cap to avoid infinite loops on weird data
    for (let iter = 0; iter < 20; iter++) {
      const counts = getPackCellCounts(actor);

      const hasEmpty = [1, 2, 3, 4, 5, 6].some((n) => (counts[n] ?? 0) === 0);
      if (!hasEmpty) return;

      // Find items that are currently stacked (max stack across their footprint >= 2)
      const packItems = actor.items.filter((it) => it.getFlag(MODULE_ID, INV_FLAG_KEY)?.zone === "pack");
      const stacked = [];
      for (const it of packItems) {
        const layout = it.getFlag(MODULE_ID, INV_FLAG_KEY);
        const cells = layout?.cells ?? [];
        const packNums = cells
          .filter((c) => String(c).startsWith("pack:"))
          .map((c) => Number(String(c).split(":")[1]))
          .filter((n) => Number.isFinite(n));
        if (!packNums.length) continue;
        const maxStack = Math.max(...packNums.map((n) => counts[n] ?? 0));
        if (maxStack >= 2) stacked.push({ it, maxStack });
      }

      if (!stacked.length) return;

      // Move the most-stacked first, so we peel stacks down quickly
      stacked.sort((a, b) => b.maxStack - a.maxStack);

      let moved = false;

      for (const { it } of stacked) {
        const { w, h } = getItemFootprint(it);

        // Counts excluding this item (so its current footprint becomes available)
        const countsExcl = getPackCellCounts(actor, it.id);
        const auto = chooseAutoPackPlacement(it, w, h, map, countsExcl);

        // Only move if we can fit into a fully empty footprint
        if (auto?.allEmpty) {
          await moveItemToPlacement(it, auto.placement, map, auto.anchor.id);
          moved = true;
          break;
        }
      }

      if (!moved) return;
      // Loop again: counts changed, maybe still empties + stacks
    }
  });

  __mrqolPackRebalanceInFlight.set(key, next);
  try {
    await next;
  } finally {
    if (__mrqolPackRebalanceInFlight.get(key) === next) __mrqolPackRebalanceInFlight.delete(key);
  }
}


function shouldBeEncumbered(actor) {
  const counts = getEffectivePackCellCounts(actor);
  return [1, 2, 3, 4, 5, 6].some((n) => (counts[n] ?? 0) >= 2);
}

async function refreshEncumbered(actor) {
  if (!actor) return;
  await setActorEncumbered(actor, shouldBeEncumbered(actor));
}

function enforceEncumberedOnTokenUpdate(tokenDoc) {
  try {
    const actor = tokenDoc?.actor;
    if (!actor) return;
    setActorEncumbered(actor, shouldBeEncumbered(actor)).catch(() => {});
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
      if (!shouldBeEncumbered(actor)) return;

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
/* Zone restrictions                             */
/* -------------------------------------------- */

function allowedZonesForItem(item) {
  if (item.type === "condition") return new Set(["pack", "grit"]);
  return null;
}

function isZoneAllowedForItem(item, zone) {
  const allowed = allowedZonesForItem(item);
  if (!allowed) return true;
  return allowed.has(zone);
}

/* -------------------------------------------- */
/* Overlap policy                               */
/* -------------------------------------------- */

function isExclusiveCell(cellId) {
  if (cellId.startsWith("carried:")) return true;
  if (cellId.startsWith("worn:")) return true;
  if (cellId.startsWith("grit:")) return true;
  if (cellId.startsWith("bank:")) return true;
  if (cellId.startsWith("pack:")) return false;
  return true;
}

/* -------------------------------------------- */
/* Inventory cell map from DOM                  */
/* -------------------------------------------- */

function buildInventoryCells(root) {
  const dragArea = root.querySelector("#drag-area");
  if (!dragArea) return null;

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
      const parts = m[1].split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      if (parts.length === 16) return { x: parts[12], y: parts[13] };
    }

    return null;
  };

  // --- Pack cells (6) ---
  for (const el of slotEls) {
    const bagText = el.querySelector(".item-bag-text");
    if (!bagText) continue;

    const n = Number(bagText.textContent.trim());
    if (!Number.isFinite(n)) continue;

    packSlotsByN[n] = el;

    const pos = parseTranslate3d(el);
    if (pos) slotPosByCellId[`pack:${n}`] = pos;

    // IMPORTANT: rects are viewport-space for overlap detection
    cells.push({ id: `pack:${n}`, zone: "pack", rect: rectFromEl(el), el });
  }

  // --- Determine inventory-space cell size using SIGNED deltas ---
  let cellWInv = null;
  let cellHInv = null;

  if (slotPosByCellId["pack:1"] && slotPosByCellId["pack:2"]) {
    cellWInv = slotPosByCellId["pack:2"].x - slotPosByCellId["pack:1"].x; // signed!
  }
  if (slotPosByCellId["pack:1"] && slotPosByCellId["pack:4"]) {
    cellHInv = slotPosByCellId["pack:4"].y - slotPosByCellId["pack:1"].y; // signed!
  }

  // Fallback to screen size if transforms aren't available
  if (!Number.isFinite(cellWInv)) {
    const r = packSlotsByN[1]?.getBoundingClientRect();
    cellWInv = r?.width ?? 100;
  }
  if (!Number.isFinite(cellHInv)) {
    const r = packSlotsByN[1]?.getBoundingClientRect();
    cellHInv = r?.height ?? 100;
  }

  // --- Special slots by header ---
  const specials = [];
  for (const el of slotEls) {
    const header = el.querySelector(".item-slot-header")?.textContent?.trim();
    if (!header) continue;

    if (header === "Main Paw") specials.push({ id: "carried:main", zone: "carried", rect: rectFromEl(el), el });
    if (header === "Off Paw") specials.push({ id: "carried:off", zone: "carried", rect: rectFromEl(el), el });
    if (header === "Body") specials.push({ id: "worn:body", zone: "worn", rect: rectFromEl(el), el }); // 2 entries
    if (header === "Grit") specials.push({ id: "grit:all", zone: "grit", rect: rectFromEl(el), el });
    if (header === "Bank") specials.push({ id: "bank:all", zone: "bank", rect: rectFromEl(el), el });
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

  // Split Grit into 2 cells (use translate3d of container + SIGNED cellWInv)
  const gritAll = specials.find((s) => s.id === "grit:all");
  if (gritAll) {
    const r = gritAll.rect;
    const cwScreen = r.width / 2;

    const pos = parseTranslate3d(gritAll.el);
    if (pos) {
      slotPosByCellId["grit:1"] = { x: pos.x, y: pos.y };
      slotPosByCellId["grit:2"] = { x: pos.x + cellWInv, y: pos.y }; // signed step
    }

    cells.push({ id: "grit:1", zone: "grit", rect: { ...r, right: r.left + cwScreen, width: cwScreen } });
    cells.push({ id: "grit:2", zone: "grit", rect: { ...r, left: r.left + cwScreen, width: cwScreen } });
  }

  // Split Bank into 3 cells (use translate3d of container + SIGNED cellWInv)
  const bankAll = specials.find((s) => s.id === "bank:all");
  if (bankAll) {
    const r = bankAll.rect;
    const cwScreen = r.width / 3;

    const pos = parseTranslate3d(bankAll.el);
    if (pos) {
      for (let i = 0; i < 3; i++) {
        slotPosByCellId[`bank:${i + 1}`] = { x: pos.x + cellWInv * i, y: pos.y };
      }
    }

    for (let i = 0; i < 3; i++) {
      cells.push({
        id: `bank:${i + 1}`,
        zone: "bank",
        rect: { ...r, left: r.left + cwScreen * i, right: r.left + cwScreen * (i + 1), width: cwScreen }
      });
    }
  }

  // Pack is 3x2
  const packIndexToCR = (n) => {
    const idx = n - 1;
    return { col: idx % 3, row: Math.floor(idx / 3) };
  };
  const packCRToIndex = (col, row) => row * 3 + col + 1;

  return { cells, packSlotsByN, slotPosByCellId, cellWInv, cellHInv, packIndexToCR, packCRToIndex };
}


/* -------------------------------------------- */
/* Special placements (equipment)               */
/* -------------------------------------------- */

function getSpecialPlacement(item, anchorCellId, w, h) {
  const type = item.type;

  if (type === "armor" && w === 2 && h === 1) {
    if (anchorCellId === "carried:off" || anchorCellId === "worn:bottom") {
      return { zone: "worn", cells: ["carried:off", "worn:bottom"] };
    }
    return null;
  }

  if (type === "armor" && w === 1 && h === 2) {
    if (anchorCellId === "worn:top" || anchorCellId === "worn:bottom") {
      return { zone: "worn", cells: ["worn:top", "worn:bottom"] };
    }
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
  if (!isZoneAllowedForItem(item, anchorCell.zone)) return null;

  const special = getSpecialPlacement(item, anchorCell.id, w, h);
  if (special) return special;

  const id = anchorCell.id;

  // carried/worn 1x1 only
  if (id.startsWith("carried:") || id.startsWith("worn:")) {
    if (w === 1 && h === 1) return { zone: anchorCell.zone, cells: [id] };
    return null;
  }

  // grit: 2 cols, horizontal only
  if (id.startsWith("grit:")) {
    if (h !== 1) return null;
    const start = Number(id.split(":")[1]);
    if (!Number.isFinite(start) || start < 1 || start > 2) return null;
    if (start + w - 1 > 2) return null;
    return { zone: "grit", cells: Array.from({ length: w }, (_, i) => `grit:${start + i}`) };
  }

  // bank: 3 cols, horizontal only
  if (id.startsWith("bank:")) {
    if (h !== 1) return null;
    const start = Number(id.split(":")[1]);
    if (!Number.isFinite(start) || start < 1 || start > 3) return null;
    if (start + w - 1 > 3) return null;
    return { zone: "bank", cells: Array.from({ length: w }, (_, i) => `bank:${start + i}`) };
  }

  // pack: 3x2
  if (id.startsWith("pack:")) {
    const start = Number(id.split(":")[1]);
    if (!Number.isFinite(start) || start < 1 || start > 6) return null;

    const { col: c0, row: r0 } = map.packIndexToCR(start);
    if (c0 + w - 1 > 2) return null;
    if (r0 + h - 1 > 1) return null;

    const out = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const n = map.packCRToIndex(c0 + dx, r0 + dy);
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
      const blocked = placement.cells.some((cid) => isExclusiveCell(cid) && occupied.has(cid));
      if (blocked) continue;
    }

    if (!best || area > best.area) best = { anchor: c, placement, area };
  }

  return best;
}

/* -------------------------------------------- */
/* Pack auto-placement + UI tooltips/badges     */
/* -------------------------------------------- */

function chooseAutoPackPlacement(item, w, h, map, counts) {
  const candidates = [];

  for (let start = 1; start <= 6; start++) {
    const anchor = map.cells.find((c) => c.id === `pack:${start}`);
    if (!anchor) continue;

    const placement = getPlacementForAnchor(item, anchor, w, h, map);
    if (!placement || placement.zone !== "pack") continue;

    const cellNums = placement.cells
      .filter((c) => c.startsWith("pack:"))
      .map((c) => Number(c.split(":")[1]))
      .filter((n) => Number.isFinite(n));

    if (!cellNums.length) continue;

    const maxStack = Math.max(...cellNums.map((n) => counts[n] ?? 0));
    const allEmpty = cellNums.every((n) => (counts[n] ?? 0) === 0);
    candidates.push({ start, anchor, placement, maxStack, allEmpty });
  }

  candidates.sort((a, b) => a.start - b.start);
  const empty = candidates.find((c) => c.allEmpty);
  if (empty) return empty;

  candidates.sort((a, b) => a.maxStack - b.maxStack || a.start - b.start);
  return candidates[0] ?? null;
}

function refreshPackSlotTooltips(map, actor) {
  if (!map?.packSlotsByN) return;
  const counts = getPackCellCounts(actor);

  for (let n = 1; n <= 6; n++) {
    const el = map.packSlotsByN[n];
    if (!el) continue;

    const c = counts[n] ?? 0;
    if (c >= 2) el.setAttribute("title", `Pack ${n}: ${c} items`);
    else el.removeAttribute("title");
  }
}

function refreshPackStackBadgesAndTooltips(app, root) {
  const actor = app?.actor;
  if (!actor) return;

  const counts = getPackCellCounts(actor);
  const itemCards = Array.from(root.querySelectorAll(".item-card[data-item-id]"));

  for (const el of itemCards) {
    const itemId = el.dataset.itemId;
    const item = actor.items.get(itemId);
    if (!item) continue;

    const layout = item.getFlag(MODULE_ID, INV_FLAG_KEY);
    if (!layout?.cells || layout.zone !== "pack") {
      delete el.dataset.mrqolStackTitle;
      clearStackBadge(el);
      applyItemTitle(el);
      continue;
    }

    const packCells = layout.cells
      .filter((c) => c.startsWith("pack:"))
      .map((c) => Number(c.split(":")[1]))
      .filter((n) => Number.isFinite(n));

    if (!packCells.length) {
      delete el.dataset.mrqolStackTitle;
      clearStackBadge(el);
      applyItemTitle(el);
      continue;
    }

    const maxStack = Math.max(...packCells.map((n) => counts[n] ?? 0));
    if (maxStack >= 2) {
      el.dataset.mrqolStackTitle = `Pack stack: ${maxStack}`;
      ensureStackBadge(el).textContent = String(maxStack);
    } else {
      delete el.dataset.mrqolStackTitle;
      clearStackBadge(el);
    }

    applyItemTitle(el);
  }
}

/* -------------------------------------------- */
/* Grit rules                                  */
/* -------------------------------------------- */

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

function getGritCapacity(actor) {
  return Number(actor?.system?.grit?.value ?? 0);
}

function chooseAutoGritPlacement(actor, excludeItemId = null) {
  const cap = getGritCapacity(actor);
  if (cap <= 0) return null;

  const occ = getOccupiedCells(actor, excludeItemId);
  const slots = ["grit:1", "grit:2"].slice(0, Math.min(2, cap));
  for (const s of slots) {
    if (!occ.has(s)) return { zone: "grit", cells: [s] };
  }
  return null;
}

function isAmmo(item) {
  const tag = item.system?.tag ?? item.system?.category ?? "";
  return String(tag).toLowerCase() === "ammunition";
}

function isEquippedByLayout(item) {
  const layout = item.getFlag(MODULE_ID, INV_FLAG_KEY);
  if (!layout) return false;
  if (item.type === "weapon") return layout.zone === "carried";
  if (item.type === "armor") return layout.zone === "worn";
  if (isAmmo(item)) return layout.zone === "worn";
  return false;
}

function isGritActiveByLayout(item) {
  const layout = item.getFlag(MODULE_ID, INV_FLAG_KEY);
  return item.type === "condition" && layout?.zone === "grit";
}

/* -------------------------------------------- */
/* Invalid markers                              */
/* -------------------------------------------- */

function refreshInvalidMarkers(app, root) {
  const actor = app?.actor;
  if (!actor) return;

  const enabled = safeGetSetting("core.inventoryLayout.enabled", true);
  if (!enabled) return;

  const itemCards = Array.from(root.querySelectorAll(".item-card[data-item-id]"));
  for (const el of itemCards) {
    const itemId = el.dataset.itemId;
    const item = actor.items.get(itemId);
    if (!item) continue;

    const layout = item.getFlag(MODULE_ID, INV_FLAG_KEY);

    if (!layout) {
      if (isItemIncorrectPlacement(item)) item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, false).catch(() => {});
      clearInvalidMark(el);
      continue;
    }

    if (item.type === "condition" && !["pack", "grit"].includes(layout.zone)) {
      markInvalid(el, "Invalid placement: Conditions must be in Pack or Grit.");
      item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, true).catch(() => {});
      continue;
    }

    if (layout.zone === "grit" && item.type !== "condition") {
      markInvalid(el, "Invalid placement: Only Conditions can be stored in Grit.");
      item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, true).catch(() => {});
      continue;
    }

    if (isItemIncorrectPlacement(item)) item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, false).catch(() => {});
    clearInvalidMark(el);
  }
}

/* -------------------------------------------- */
/* Main: apply from DOM on drag end             */
/* -------------------------------------------- */

async function applyInventoryLayoutFromDOM(app, root, itemId) {
  const actor = app?.actor;
  if (!actor) return;

  const map = buildInventoryCells(root);
  if (!map) return;

  const item = actor.items.get(itemId);
  if (!item) return;

  const enabled = safeGetSetting("core.inventoryLayout.enabled", true);
  if (!enabled) return;

  const safeId = globalThis.CSS?.escape ? CSS.escape(itemId) : itemId;
  let itemEl = root.querySelector(`.item-card[data-item-id="${safeId}"]`);
  if (!itemEl) itemEl = root.querySelector(`[data-item-id="${safeId}"]`);
  if (!itemEl) return;

  const strict = safeGetSetting("core.inventoryLayout.strict", true);
  const threshold = Number(safeGetSetting("core.inventoryLayout.threshold", 0.35));
  const snap = safeGetSetting("core.inventoryLayout.snap", true);

  const itemRect = rectFromEl(itemEl); // (se queda igual, ahora cells[].rect también está en viewport)
  const { w, h, rotation } = getItemFootprint(item);

  const occupied = strict ? buildOccupiedSet(actor, itemId) : null;
  let found = findBestPlacement(item, itemRect, w, h, map, { threshold, strict, occupied });

  // If dropped onto Pack, auto-place
  if (found?.placement?.zone === "pack") {
    const counts = getPackCellCounts(actor, itemId);
    const auto = chooseAutoPackPlacement(item, w, h, map, counts);
    if (auto) found = { anchor: auto.anchor, placement: auto.placement, area: found.area };
  }

  // Invalid placement
  if (!found) {
    const reason =
      item.type === "condition"
        ? "Invalid placement: Conditions must be in Pack or Grit."
        : "Invalid placement: drop into a valid slot.";
    markInvalid(itemEl, reason);
    try {
      await item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, true);
    } catch (_) {}

    refreshInvalidMarkers(app, root);
    refreshPackStackBadgesAndTooltips(app, root);
    refreshPackSlotTooltips(map, actor);
    await refreshEncumbered(actor);
    return;
  }

  // Enforce Grit rules
  if (found.placement.zone === "grit") {
    if (item.type !== "condition") {
      markInvalid(itemEl, "Invalid placement: Only Conditions can be stored in Grit.");
      try {
        await item.setFlag(MODULE_ID, INVALID_PLACEMENT_FLAG, true);
      } catch (_) {}
      refreshInvalidMarkers(app, root);
      refreshPackStackBadgesAndTooltips(app, root);
      refreshPackSlotTooltips(map, actor);
      await refreshEncumbered(actor);
      return;
    }

    const pref = chooseAutoGritPlacement(actor, itemId);
    if (!pref) {
      ui.notifications?.warn?.("No hay espacios de Agallas disponibles");

      const counts = getPackCellCounts(actor, itemId);
      const auto = chooseAutoPackPlacement(item, w, h, map, counts);

      if (!auto) {
        markInvalid(itemEl, "No space: Pack auto-placement failed.");
        refreshInvalidMarkers(app, root);
        refreshPackStackBadgesAndTooltips(app, root);
        refreshPackSlotTooltips(map, actor);
        await refreshEncumbered(actor);
        return;
      }

      found = { anchor: auto.anchor, placement: auto.placement, area: found.area };
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

  // If layout didn't change, do nothing. (Avoid repeated writes that can cause visual jitter.)
  if (same) {
    refreshInvalidMarkers(app, root);
    refreshPackStackBadgesAndTooltips(app, root);
    refreshPackSlotTooltips(map, actor);
    await refreshEncumbered(actor);
    return;
  }

  let updateData = {
    [`flags.${MODULE_ID}.${INV_FLAG_KEY}`]: { zone, cells, w, h, rotation }
  };

  /**
   * SNAP FIX:
   * - Use the slot's translate3d coordinates (same space Mausritter stores in item.system.sheet.*)
   * - Keep the SIGN of cellWInv/cellHInv for multi-cell offsets.
   * - Write ALL 6 fields consistently (Mausritter uses these in different moments).
   */
if (snap) {
  const anchorId = anchor?.id ?? placement?.cells?.[0];
  const base = map?.slotPosByCellId?.[anchorId];

  if (base && Number.isFinite(base.x) && Number.isFinite(base.y)) {
    const cellW = Number(map?.cellWInv ?? 0) || 0;
    const cellH = Number(map?.cellHInv ?? 0) || 0;

    // Mausritter treats sheet coords as centers; keep SIGN for multi-cell offsets
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

  // Set derived flags in the same update (avoid extra update loops)
  updateData[`flags.${MODULE_ID}.${INVALID_PLACEMENT_FLAG}`] = false;

  if (item.type === "condition") {
    updateData[`flags.${MODULE_ID}.${GRIT_ACTIVE_FLAG}`] = (zone === "grit");
  } else if (item.type === "weapon" || item.type === "armor" || isAmmo(item)) {
    updateData[`flags.${MODULE_ID}.${EQUIPPED_FLAG}`] =
      (item.type === "weapon" ? zone === "carried" : zone === "worn");
  }

  await item.update(updateData);

  refreshInvalidMarkers(app, root);
  refreshPackStackBadgesAndTooltips(app, root);
  refreshPackSlotTooltips(map, actor);
  await refreshEncumbered(actor);
}

// ------------------------------------------------------------
// Debounced sheet refresh (prevents recursion/loops)
// ------------------------------------------------------------
const __mrqolActorRefreshTimers = new Map();

function scheduleActorSheetRefresh(actor) {
  if (!actor) return;

  const key = actor.uuid ?? actor.id;
  if (__mrqolActorRefreshTimers.has(key)) return;

  const t = setTimeout(() => {
    __mrqolActorRefreshTimers.delete(key);
    try {
      // Re-render open actor sheets so Mausritter re-applies sheet coords and snaps visually
      const entries = getOpenActorSheetRoots(actor.id);
      for (const { app } of entries) {
        try { app?.render?.(false); } catch (_) {}
      }

      // Also refresh our UI overlays/badges/etc
      refreshInventoryUIForActor(actor).catch(() => {});
    } catch (_) {}
  }, 0);

  __mrqolActorRefreshTimers.set(key, t);
}

/* -------------------------------------------- */
/* Helpers: move / equip toggles                */
/* -------------------------------------------- */
// ------------------------------------------------------------
// Pack compaction (keep stacks only if no empty slots exist)
// ------------------------------------------------------------

const __mrqolPackCompactInFlight = new Map();

function isPack1x1(item) {
  const { w, h } = getItemFootprint(item);
  const layout = item.getFlag(MODULE_ID, INV_FLAG_KEY);
  return layout?.zone === "pack" && w === 1 && h === 1 && Array.isArray(layout.cells) && layout.cells.length === 1;
}

function getPackIndexFromLayout(item) {
  const layout = item.getFlag(MODULE_ID, INV_FLAG_KEY);
  const cid = layout?.cells?.[0];
  if (!cid || !cid.startsWith("pack:")) return null;
  const n = Number(cid.split(":")[1]);
  return Number.isFinite(n) ? n : null;
}

function buildPackBuckets(actor) {
  const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const it of actor.items) {
    if (!isPack1x1(it)) continue;
    const n = getPackIndexFromLayout(it);
    if (!n || !(n in buckets)) continue;
    buckets[n].push(it);
  }
  return buckets;
}

function getEmptySlotsFromBuckets(buckets) {
  const empties = [];
  for (let n = 1; n <= 6; n++) {
    if ((buckets[n]?.length ?? 0) === 0) empties.push(n);
  }
  return empties;
}

function getStackedSlotsFromBuckets(buckets) {
  const stacked = [];
  for (let n = 1; n <= 6; n++) {
    const c = buckets[n]?.length ?? 0;
    if (c >= 2) stacked.push({ n, count: c });
  }
  // Prefer taking from the most stacked first
  stacked.sort((a, b) => b.count - a.count || a.n - b.n);
  return stacked;
}

async function movePackItemToSlot(item, map, slotN) {
  const actor = item?.parent;
  if (!actor) return;

  // Update flags + snap coords (ALL 6 fields)
  const { rotation } = getItemFootprint(item);
  const updateData = {
    [`flags.${MODULE_ID}.${INV_FLAG_KEY}`]: { zone: "pack", cells: [`pack:${slotN}`], w: 1, h: 1, rotation },
    [`flags.${MODULE_ID}.${INVALID_PLACEMENT_FLAG}`]: false,
    [`flags.${MODULE_ID}.${EQUIPPED_FLAG}`]: false,
    [`flags.${MODULE_ID}.${GRIT_ACTIVE_FLAG}`]: false
  };

  const base = map?.slotPosByCellId?.[`pack:${slotN}`];
  if (base && Number.isFinite(base.x) && Number.isFinite(base.y)) {
    updateData["system.sheet.currentX"] = base.x;
    updateData["system.sheet.currentY"] = base.y;
    updateData["system.sheet.xOffset"] = base.x;
    updateData["system.sheet.yOffset"] = base.y;
    updateData["system.sheet.initialX"] = base.x;
    updateData["system.sheet.initialY"] = base.y;
  }

  await item.update(updateData);

  // Key: force a UI refresh (without recursion)
  scheduleActorSheetRefresh(actor);
}

async function compactPackIfNeeded(actor) {
  if (!actor) return;
  if (!safeGetSetting("core.inventoryLayout.enabled", true)) return;

  // Serialize per actor (avoid loops/races with updateItem hooks)
  const key = actor.uuid ?? actor.id;
  const prev = __mrqolPackCompactInFlight.get(key) ?? Promise.resolve();

  const next = prev.finally(async () => {
    // Need a map (for snap coords). If no sheet open, we can still compact flags,
    // but snap will be skipped (base undefined).
    const entries = getOpenActorSheetRoots(actor.id);
    const map = entries[0] ? buildInventoryCells(entries[0].root) : null;

    let safety = 0;

    while (safety++ < 20) {
      const buckets = buildPackBuckets(actor);
      const empties = getEmptySlotsFromBuckets(buckets);
      if (!empties.length) return;

      const stacked = getStackedSlotsFromBuckets(buckets);
      if (!stacked.length) return;

      // Take from the most stacked slot, but keep one item there.
      const src = stacked[0].n;
      const srcItems = buckets[src];
      if (!srcItems || srcItems.length < 2) return;

      // Move the "last" item in that stack into the first empty slot
      const itemToMove = srcItems[srcItems.length - 1];
      const dst = empties[0];

      await movePackItemToSlot(itemToMove, map, dst);

      // Loop to keep compacting until no empties OR no stacks
      // (actor.items is live; re-read buckets each iteration)
    }
  });

  __mrqolPackCompactInFlight.set(key, next);
  try { await next; } finally {
    if (__mrqolPackCompactInFlight.get(key) === next) __mrqolPackCompactInFlight.delete(key);
  }
}

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

  if (item.type === "condition") {
    updateData[`flags.${MODULE_ID}.${GRIT_ACTIVE_FLAG}`] = placement.zone === "grit";
    updateData[`flags.${MODULE_ID}.${EQUIPPED_FLAG}`] = false;
  } else if (item.type === "weapon" || item.type === "armor" || isAmmo(item)) {
    updateData[`flags.${MODULE_ID}.${EQUIPPED_FLAG}`] =
      item.type === "weapon" ? placement.zone === "carried" : placement.zone === "worn";
    updateData[`flags.${MODULE_ID}.${GRIT_ACTIVE_FLAG}`] = false;
  }

  // Snap (write ALL 6 fields)
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

  await item.update(updateData);

  // Key: force a UI refresh (without recursion)
  scheduleActorSheetRefresh(actor);
}


function getCellById(map, id) {
  return map?.cells?.find((c) => c.id === id) ?? null;
}

async function equipItemToSlots(item, map) {
  const actor = item.parent;
  const occ = getOccupiedCells(actor, item.id);
  const { w, h } = getItemFootprint(item);

  const tryAnchors = (anchorIds) => {
    for (const aid of anchorIds) {
      const cell = getCellById(map, aid);
      if (!cell) continue;
      const placement = getPlacementForAnchor(item, cell, w, h, map);
      if (!placement) continue;
      if (isPlacementBlocked(placement, occ)) continue;
      return { placement, anchorId: aid };
    }
    return null;
  };

  if (item.type === "weapon") {
    const res = tryAnchors(["carried:main", "carried:off"]);
    if (!res) {
      ui.notifications?.warn?.("No hay espacios disponibles para equipar el arma");
      return false;
    }
    await moveItemToPlacement(item, res.placement, map, res.anchorId);
    return true;
  }

  if (item.type === "armor") {
    if (w === 2 && h === 1) {
      const res = tryAnchors(["carried:off", "worn:bottom"]);
      if (!res) {
        ui.notifications?.warn?.("No hay espacios disponibles para equipar la armadura");
        return false;
      }
      await moveItemToPlacement(item, res.placement, map, res.anchorId);
      return true;
    }
    if (w === 1 && h === 2) {
      const res = tryAnchors(["worn:top", "worn:bottom"]);
      if (!res) {
        ui.notifications?.warn?.("No hay espacios disponibles para equipar la armadura");
        return false;
      }
      await moveItemToPlacement(item, res.placement, map, res.anchorId);
      return true;
    }

    const res = tryAnchors(["worn:top", "worn:bottom"]);
    if (!res) {
      ui.notifications?.warn?.("No hay espacios disponibles para equipar la armadura");
      return false;
    }
    await moveItemToPlacement(item, res.placement, map, res.anchorId);
    return true;
  }

  if (isAmmo(item)) {
    const res = tryAnchors(["worn:top", "worn:bottom"]);
    if (!res) {
      ui.notifications?.warn?.("No hay espacios disponibles para equipar la munición");
      return false;
    }
    await moveItemToPlacement(item, res.placement, map, res.anchorId);
    return true;
  }

  return false;
}

async function moveItemToPackAuto(item, map) {
  const actor = item.parent;
  const { w, h } = getItemFootprint(item);
  const counts = getPackCellCounts(actor, item.id);
  const auto = chooseAutoPackPlacement(item, w, h, map, counts);
  if (!auto) {
    ui.notifications?.warn?.("No space in Pack");
    return false;
  }
  await moveItemToPlacement(item, auto.placement, map, auto.anchor.id);
  return true;
}

async function toggleEquipForItem(actor, itemId, map) {
  const item = actor.items.get(itemId);
  if (!item) return;
  if (item.type === "condition") return;

  const equipped = isEquippedByLayout(item);

  if (equipped) {
    await moveItemToPackAuto(item, map);
    await compactPackIfNeeded(actor).catch(() => {});
  } else {
    await equipItemToSlots(item, map);
  }
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
    ui.notifications?.warn?.("No hay espacios de Agallas disponibles");
    return;
  }
  await moveItemToPlacement(item, placement, map, placement.cells[0]);
}

function refreshToggleButtons(app, root, map) {
  const actor = app?.actor;
  if (!actor) return;

  const cards = Array.from(root.querySelectorAll(".item-card[data-item-id]"));
  for (const card of cards) {
    const itemId = card.dataset.itemId;
    const item = actor.items.get(itemId);
    if (!item) continue;

    // Ensure a top-right overlay container exists on the card
    let toggles = card.querySelector(".mrqol-card-toggles");
    if (!toggles) {
      toggles = document.createElement("div");
      toggles.className = "mrqol-card-toggles";
      card.appendChild(toggles);
    }

    // Clean up legacy buttons that might have been injected into .item-controls previously
    const legacyEquip = card.querySelector(".item-controls .mrqol-equip-toggle");
    if (legacyEquip) legacyEquip.remove();
    const legacyGrit = card.querySelector(".item-controls .mrqol-grit-toggle");
    if (legacyGrit) legacyGrit.remove();

    // Equip toggle (weapon/armor/ammo)
    const needsEquip = item.type === "weapon" || item.type === "armor" || isAmmo(item);
    if (needsEquip) {
      let btn = toggles.querySelector(".mrqol-equip-toggle");
      if (!btn) {
        btn = document.createElement("a");
        btn.className = "item-control mrqol-equip-toggle mrqol-toggle";
        btn.setAttribute("title", "Equip/Unequip");

        // Use safe core FA icons (avoid missing/brand icons)
        const iconClass =
          item.type === "armor" ? "fa-solid fa-shield-halved" : "fa-solid fa-sword";

        btn.innerHTML = `<i class="${iconClass}"></i>`;
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toggleEquipForItem(actor, itemId, map).catch(() => {});
        });

        toggles.appendChild(btn);
      }

      btn.classList.toggle("mrqol-active", isEquippedByLayout(item));
    } else {
      // If not applicable anymore, remove any leftover equip toggle in this card
      const btn = toggles.querySelector(".mrqol-equip-toggle");
      if (btn) btn.remove();
    }

    // Grit toggle (conditions only)
    if (item.type === "condition") {
      let btn = toggles.querySelector(".mrqol-grit-toggle");
      if (!btn) {
        btn = document.createElement("a");
        btn.className = "item-control mrqol-grit-toggle mrqol-toggle";
        btn.setAttribute("title", "Grit");
        btn.innerHTML = `<i class="fa-solid fa-bolt"></i>`;
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toggleGritForCondition(actor, itemId, map).catch(() => {});
        });

        toggles.appendChild(btn);
      }

      btn.classList.toggle("mrqol-active", isGritActiveByLayout(item));
    } else {
      // If not a condition, remove any leftover grit toggle in this card
      const btn = toggles.querySelector(".mrqol-grit-toggle");
      if (btn) btn.remove();
    }

    // If overlay ended up empty, remove it (keeps DOM clean)
    if (!toggles.children.length) toggles.remove();
  }
}

async function refreshInventoryUIForActor(actor) {
  if (!actor) return;
  const entries = getOpenActorSheetRoots(actor.id);
  for (const { app, root } of entries) {
    const map = buildInventoryCells(root);
    refreshToggleButtons(app, root, map);
    refreshInvalidMarkers(app, root);
    refreshPackStackBadgesAndTooltips(app, root);
    if (map) refreshPackSlotTooltips(map, actor);
  }
  await refreshEncumbered(actor);
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

  if (root.dataset.mrqolInvLayoutHooked === "1") return;
  root.dataset.mrqolInvLayoutHooked = "1";

  bindRollContext(app, root);

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
/* Core hooks: refresh on item changes           */
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

        const map = buildInventoryCells(first.root);
        if (!map) return;

        await moveItemToPackAuto(item, map);
      } catch (e) {
        console.warn(`${MODULE_ID} | createItem auto-place failed`, e);
} finally {
  await compactPackIfNeeded(actor).catch(() => {});
  refreshInventoryUIForActor(actor).catch(() => {});
}
    });
  });

Hooks.on("updateItem", (item, change) => {
  const actor = item?.parent;
  if (actor?.documentName !== "Actor") return;

  const affectsLayout =
    change?.flags?.[MODULE_ID]?.[INV_FLAG_KEY] != null ||
    change?.system?.sheet != null ||
    change?.system?.size != null;

  if (!affectsLayout) return;

  // Refresh UI
  refreshInventoryUIForActor(actor).catch(() => {});

  // If an item moved/deleted-from-pack etc. we may have created empty slots => compact
  afterTwoFrames(() => compactPackIfNeeded(actor).catch(() => {}));
});

Hooks.on("preDeleteItem", (item) => {
  const actor = item?.parent;
  if (actor?.documentName !== "Actor") return;

  // Espera a que el borrado se aplique realmente sobre actor.items
  afterTwoFrames(async () => {
    try {
      await compactPackIfNeeded(actor);
    } catch (_) {}
    refreshInventoryUIForActor(actor).catch(() => {});
  });
});

Hooks.on("updateActor", (actor, change) => {
    if (actor?.documentName !== "Actor") return;
    if (change?.system?.grit != null) refreshInventoryUIForActor(actor).catch(() => {});
  });

  Hooks.on("updateToken", (tokenDoc, change) => {
    if (!tokenDoc?.actor) return;
    if (change?.effects != null || change?.statuses != null) enforceEncumberedOnTokenUpdate(tokenDoc);
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

    // Repairs
    Hooks.on("renderItemSheet", injectRepairsUI);
    Hooks.on("getApplicationHeaderButtons", addHeaderButtons);
    Hooks.on("getApplicationV1HeaderButtons", addHeaderButtons);
    Hooks.on("getItemSheetHeaderButtons", addHeaderButtons);

    // Inventory layout
    Hooks.on("renderActorSheet", registerInventoryLayoutOnActorSheet);
    Hooks.on("renderActorSheetV2", registerInventoryLayoutOnActorSheet);
  },

  ready() {}
};

PackManager.register(CorePack);
