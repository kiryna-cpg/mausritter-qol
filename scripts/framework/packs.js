import { MODULE_ID } from "./paths.js";

export class PackManager {
  static packs = [];

  static register(pack) {
    this.packs.push(pack);
  }

  static isEnabled(packId) {
    return game.settings.get(MODULE_ID, `packs.${packId}.enabled`);
  }

  static init() {
    for (const pack of this.packs) if (this.isEnabled(pack.id)) pack.init();
  }

  static ready() {
    for (const pack of this.packs) if (this.isEnabled(pack.id)) pack.ready();
  }
}
