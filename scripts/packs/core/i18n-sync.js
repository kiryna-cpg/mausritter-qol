import { MODULE_ID } from "../../framework/paths.js";

/**
 * Sheet Language Sync (EN/ES)
 *
 * Goal:
 * - Let the user click a button on Actor/Item sheets to sync document data to EN or ES
 * - Works even if the doc was imported in the "other" language
 *
 * Strategy:
 * - Item packs JSON: keyed by EN name with ES in value.name (+ value.description often)
 *   -> build forward EN->ES and reverse ES->EN maps
 * - Creature Actors: current file is ES-only keyed by compendium id.
 *   -> optional bilingual support if you provide babele/mausritter.creatures.en.json keyed by the same ids.
 *
 * Data safety:
 * - We store small backups in flags for descriptions so EN can be restored even when only ES description exists.
 */

const FILES = {
  creaturesEs: `modules/${MODULE_ID}/babele/mausritter.creatures.json`,
  creaturesEn: `modules/${MODULE_ID}/babele/mausritter.creatures.en.json`, // OPTIONAL (recommended)
  weapons: `modules/${MODULE_ID}/babele/mausritter.weapons.json`,
  armor: `modules/${MODULE_ID}/babele/mausritter.armor.json`,
  gear: `modules/${MODULE_ID}/babele/mausritter.gear.json`,
  conditions: `modules/${MODULE_ID}/babele/mausritter.conditions.json`,
  spells: `modules/${MODULE_ID}/babele/mausritter.spells.json`
};

const ITEM_POOLS = ["weapons", "armor", "gear", "conditions", "spells"];

let _cache = null;

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) return null;
  return res.json();
}

function norm(s) {
  return (typeof s === "string") ? s.trim() : "";
}

function lastSegment(uuid) {
  if (!uuid || typeof uuid !== "string") return null;
  const parts = uuid.split(".");
  return parts.at(-1) ?? null;
}

function getCompendiumSourceUuid(doc) {
  return (
    doc?._stats?.compendiumSource ||
    doc?.flags?.core?.sourceId ||
    doc?.flags?.core?.compendiumSource ||
    null
  );
}

function getCompendiumId(doc) {
  const uuid = getCompendiumSourceUuid(doc);
  return lastSegment(uuid);
}

async function getMaps() {
  if (_cache) return _cache;

  const data = {};
  for (const [k, path] of Object.entries(FILES)) {
    data[k] = await loadJSON(path);
  }

  // --- Items maps: forward EN->ES, reverse ES->EN, and descriptions ES (and optional EN via backup) ---
  const itemForward = {}; // pool -> Map(EN -> {nameES, descES?})
  const itemReverse = {}; // pool -> Map(ES -> {nameEN})
  for (const pool of ITEM_POOLS) {
    const entries = data?.[pool]?.entries ?? {};
    const f = new Map();
    const r = new Map();
    for (const [enName, v] of Object.entries(entries)) {
      const esName = v?.name;
      const esDesc = v?.description ?? v?.system?.description;
      if (typeof esName === "string" && esName.trim()) {
        f.set(enName, { name: esName.trim(), description: typeof esDesc === "string" ? esDesc : null });
        f.set(enName.toLowerCase(), { name: esName.trim(), description: typeof esDesc === "string" ? esDesc : null });

        r.set(esName.trim(), { name: enName });
        r.set(esName.trim().toLowerCase(), { name: enName });
      }
    }
    itemForward[pool] = f;
    itemReverse[pool] = r;
  }

  // --- Creatures maps keyed by compendium id ---
  const creaturesEs = new Map();
  const creaturesEn = new Map();

  const esEntries = data?.creaturesEs?.entries ?? {};
  for (const [id, v] of Object.entries(esEntries)) {
    creaturesEs.set(id, v);
    creaturesEs.set(String(id).toLowerCase(), v);
  }

  const enEntries = data?.creaturesEn?.entries ?? null;
  if (enEntries) {
    for (const [id, v] of Object.entries(enEntries)) {
      creaturesEn.set(id, v);
      creaturesEn.set(String(id).toLowerCase(), v);
    }
  }

  _cache = { itemForward, itemReverse, creaturesEs, creaturesEn, hasCreaturesEn: !!enEntries };
  return _cache;
}

// Find item translation by trying every pool (weapons/armor/gear/conditions/spells)
async function translateItemName(item, targetLang) {
  const { itemForward, itemReverse } = await getMaps();
  const cur = norm(item.name);
  if (!cur) return null;

  if (targetLang === "es") {
    // If current is EN key, map forward
    for (const pool of ITEM_POOLS) {
      const hit = itemForward[pool].get(cur) ?? itemForward[pool].get(cur.toLowerCase());
      if (hit) return { pool, name: hit.name, description: hit.description };
    }
    // Already ES or unknown
    return null;
  }

  // targetLang === "en"
  for (const pool of ITEM_POOLS) {
    const hit = itemReverse[pool].get(cur) ?? itemReverse[pool].get(cur.toLowerCase());
    if (hit) return { pool, name: hit.name, description: null };
  }
  return null;
}

async function ensureItemBackup(item) {
  const path = "i18nSync.backup";
  const existing = item.getFlag?.(MODULE_ID, path);
  if (existing) return existing;

  const backup = {
    name: item.name,
    description: norm(item.system?.description)
  };
  await item.setFlag(MODULE_ID, path, backup);
  return backup;
}

async function syncEmbeddedItems(actor, targetLang) {
  let updated = 0;
  let skipped = 0;

  for (const item of actor.items) {
    // Ensure we can restore EN description later if needed
    await ensureItemBackup(item);

    const tr = await translateItemName(item, targetLang);
    if (!tr) {
      skipped++;
      continue;
    }

    const update = {};
    if (tr.name && tr.name !== item.name) update.name = tr.name;

    // For ES, we can apply ES description if present in translation JSON
    if (targetLang === "es" && typeof tr.description === "string") {
      const curDesc = norm(item.system?.description);
      if (tr.description !== curDesc) update["system.description"] = tr.description;
    }

    // For EN, restore description from backup (best-effort)
    if (targetLang === "en") {
      const backup = item.getFlag?.(MODULE_ID, "i18nSync.backup");
      if (backup && typeof backup.description === "string") {
        const curDesc = norm(item.system?.description);
        if (backup.description !== curDesc) update["system.description"] = backup.description;
      }
    }

    if (Object.keys(update).length) {
      await item.update(update);
      updated++;
    }
  }

  return { updated, skipped };
}

async function syncCreatureActorIfPossible(actor, targetLang) {
  const { creaturesEs, creaturesEn, hasCreaturesEn } = await getMaps();

  const id = getCompendiumId(actor);
  if (!id) return { updated: 0, reason: "no-sourceId" };

  if (targetLang === "es") {
    const tr = creaturesEs.get(id) ?? creaturesEs.get(String(id).toLowerCase());
    if (!tr) return { updated: 0, reason: "no-es-entry" };

    const update = {};
    if (typeof tr.name === "string" && tr.name !== actor.name) update.name = tr.name;

    const dispo = tr.disposition ?? tr.system?.description?.disposition;
    if (typeof dispo === "string") {
      const cur = norm(actor.system?.description?.disposition);
      if (dispo !== cur) update["system.description.disposition"] = dispo;
    }

    if (Object.keys(update).length) {
      await actor.update(update);
      return { updated: 1, reason: null };
    }
    return { updated: 0, reason: "no-changes" };
  }

  // targetLang === "en"
  if (!hasCreaturesEn) {
    // We can still sync embedded items, but actor core fields cannot be reliably restored
    return { updated: 0, reason: "missing-creatures-en-file" };
  }

  const tr = creaturesEn.get(id) ?? creaturesEn.get(String(id).toLowerCase());
  if (!tr) return { updated: 0, reason: "no-en-entry" };

  const update = {};
  if (typeof tr.name === "string" && tr.name !== actor.name) update.name = tr.name;

  const dispo = tr.disposition ?? tr.system?.description?.disposition;
  if (typeof dispo === "string") {
    const cur = norm(actor.system?.description?.disposition);
    if (dispo !== cur) update["system.description.disposition"] = dispo;
  }

  if (Object.keys(update).length) {
    await actor.update(update);
    return { updated: 1, reason: null };
  }
  return { updated: 0, reason: "no-changes" };
}

async function applyToActor(actor, targetLang) {
  // 1) If it's a creature imported from compendium, sync core fields where possible
  const coreRes = await syncCreatureActorIfPossible(actor, targetLang);

  // 2) Always sync embedded items
  const embRes = await syncEmbeddedItems(actor, targetLang);

  return { actorCoreUpdated: coreRes.updated, actorCoreNote: coreRes.reason, embeddedUpdated: embRes.updated, embeddedSkipped: embRes.skipped };
}

async function applyToItem(item, targetLang) {
  await ensureItemBackup(item);

  const tr = await translateItemName(item, targetLang);
  if (!tr) return { updated: 0 };

  const update = {};
  if (tr.name && tr.name !== item.name) update.name = tr.name;

  if (targetLang === "es" && typeof tr.description === "string") {
    const curDesc = norm(item.system?.description);
    if (tr.description !== curDesc) update["system.description"] = tr.description;
  }

  if (targetLang === "en") {
    const backup = item.getFlag?.(MODULE_ID, "i18nSync.backup");
    if (backup && typeof backup.description === "string") {
      const curDesc = norm(item.system?.description);
      if (backup.description !== curDesc) update["system.description"] = backup.description;
    }
  }

  if (Object.keys(update).length) {
    await item.update(update);
    return { updated: 1 };
  }
  return { updated: 0 };
}

function getDefaultTargetLang() {
  const pref = game.settings.get(MODULE_ID, "i18nSync.preferredLang");
  if (pref === "en" || pref === "es") return pref;
  // world
  return (game.i18n.lang?.startsWith("es")) ? "es" : "en";
}

function openDialogForActor(actor) {
  const title = game.i18n.localize("MRQOL.I18nSync.DialogTitle");
  const content = `
<form class="mrqol-i18n-sync">
  <div class="form-group">
    <label>${game.i18n.localize("MRQOL.I18nSync.Language")}</label>
    <select name="lang">
      <option value="en">${game.i18n.localize("MRQOL.I18nSync.EN")}</option>
      <option value="es">${game.i18n.localize("MRQOL.I18nSync.ES")}</option>
    </select>
  </div>
  <p class="notes">${game.i18n.localize("MRQOL.I18nSync.Note")}</p>
</form>`;

  const d = new Dialog({
    title,
    content,
    buttons: {
      apply: {
        label: game.i18n.localize("MRQOL.I18nSync.Apply"),
        icon: '<i class="fa-solid fa-language"></i>',
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const lang = root?.querySelector?.("select[name='lang']")?.value ?? getDefaultTargetLang();

          const res = await applyToActor(actor, lang);

          const note = res.actorCoreNote ? ` (${res.actorCoreNote})` : "";
          ui.notifications.info(
            game.i18n.format("MRQOL.I18nSync.DoneActor", {
              core: res.actorCoreUpdated,
              embedded: res.embeddedUpdated,
              skipped: res.embeddedSkipped,
              note
            })
          );
        }
      },
      cancel: { label: game.i18n.localize("MRQOL.I18nSync.Cancel") }
    },
    default: "apply",
    render: (html) => {
      const sel = html?.[0]?.querySelector?.("select[name='lang']");
      if (sel) sel.value = getDefaultTargetLang();
    }
  });

  d.render(true);
}

function openDialogForItem(item) {
  const title = game.i18n.localize("MRQOL.I18nSync.DialogTitle");
  const content = `
<form class="mrqol-i18n-sync">
  <div class="form-group">
    <label>${game.i18n.localize("MRQOL.I18nSync.Language")}</label>
    <select name="lang">
      <option value="en">${game.i18n.localize("MRQOL.I18nSync.EN")}</option>
      <option value="es">${game.i18n.localize("MRQOL.I18nSync.ES")}</option>
    </select>
  </div>
  <p class="notes">${game.i18n.localize("MRQOL.I18nSync.NoteItem")}</p>
</form>`;

  const d = new Dialog({
    title,
    content,
    buttons: {
      apply: {
        label: game.i18n.localize("MRQOL.I18nSync.Apply"),
        icon: '<i class="fa-solid fa-language"></i>',
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const lang = root?.querySelector?.("select[name='lang']")?.value ?? getDefaultTargetLang();
          const res = await applyToItem(item, lang);
          ui.notifications.info(
            game.i18n.format("MRQOL.I18nSync.DoneItem", { updated: res.updated })
          );
        }
      },
      cancel: { label: game.i18n.localize("MRQOL.I18nSync.Cancel") }
    },
    default: "apply",
    render: (html) => {
      const sel = html?.[0]?.querySelector?.("select[name='lang']");
      if (sel) sel.value = getDefaultTargetLang();
    }
  });

  d.render(true);
}

export function registerI18nSyncButtons() {
  Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
    const actor = app?.actor;
    if (!actor) return;

    buttons.unshift({
      label: game.i18n.localize("MRQOL.I18nSync.Button"),
      class: "mrqol-i18n-sync",
      icon: "fa-solid fa-language",
      onclick: () => openDialogForActor(actor)
    });
  });

  Hooks.on("getItemSheetHeaderButtons", (app, buttons) => {
    const item = app?.item ?? app?.document;
    if (!item || item.documentName !== "Item") return;

    buttons.unshift({
      label: game.i18n.localize("MRQOL.I18nSync.Button"),
      class: "mrqol-i18n-sync",
      icon: "fa-solid fa-language",
      onclick: () => openDialogForItem(item)
    });
  });
}