import { MODULE_ID, PATHS } from "../../framework/paths.js";

function getNumber(obj, path, fallback = 0) {
  const v = foundry.utils.getProperty(obj, path);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundCost(value, mode) {
  switch (mode) {
    case "floor": return Math.floor(value);
    case "round": return Math.round(value);
    case "ceil":
    default: return Math.ceil(value);
  }
}
// Devuelve { ok, reason, used, max, toRepair, perPip, total, currency }
export function getRepairQuote(item, amount) {
  const actor = item.actor;
  if (!actor) return { ok: false, reason: "noActor" };

  const max = getNumber(item, PATHS.itemPipsMax, 0);
  if (max <= 0) return { ok: false, reason: "noPips" };

  const usedRaw = getNumber(item, PATHS.itemPipsValue, 0);
  const used = Math.max(0, Math.min(max, usedRaw));
  if (used <= 0) return { ok: false, reason: "nothingToRepair" };

  const toRepair = amount === "all" ? used : 1;

  const cost = getNumber(item, PATHS.itemCost, 0);
  const rounding = game.settings.get(MODULE_ID, "core.repairs.rounding");

  const perPipRaw = cost * 0.10;
  const perPip = cost > 0 ? Math.max(1, roundCost(perPipRaw, rounding)) : 0;
  const total = perPip * toRepair;

  const currency = getNumber(actor, PATHS.actorCurrency, 0);

  return {
    ok: true,
    used,
    max,
    toRepair,
    perPip,
    total,
    currency
  };
}

export async function repairItem(item, amount) {
  if (!game.settings.get(MODULE_ID, "core.repairs.enabled")) return;

  const actor = item.actor;
  if (!actor) return ui.notifications.warn(game.i18n.localize("MRQOL.Repairs.NoActor"));
  if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("MRQOL.Repairs.NoPermission"));

  const max = getNumber(item, PATHS.itemPipsMax, 0);
  if (max <= 0) return ui.notifications.info(game.i18n.localize("MRQOL.Repairs.NoPips"));

  const usedRaw = getNumber(item, PATHS.itemPipsValue, 0);
  const used = Math.max(0, Math.min(max, usedRaw));
  if (used <= 0) return ui.notifications.info(game.i18n.localize("MRQOL.Repairs.NothingToRepair"));

  const toRepair = amount === "all" ? used : 1;

  const cost = getNumber(item, PATHS.itemCost, 0);
  const rounding = game.settings.get(MODULE_ID, "core.repairs.rounding");

  const perPipRaw = cost * 0.10;
  const perPip = cost > 0 ? Math.max(1, roundCost(perPipRaw, rounding)) : 0;
  const total = perPip * toRepair;

  const currency = getNumber(actor, PATHS.actorCurrency, 0);
  if (currency < total) {
    return ui.notifications.warn(
      game.i18n.format("MRQOL.Repairs.NotEnoughPips", { need: total, have: currency })
    );
  }

  await actor.update({ [PATHS.actorCurrency]: currency - total });
  await item.update({ [PATHS.itemPipsValue]: used - toRepair });

  ui.notifications.info(
    game.i18n.format("MRQOL.Repairs.Done", { spent: total, pips: toRepair })
  );
}
