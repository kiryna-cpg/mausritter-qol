import { PackManager } from "../../framework/packs.js";

export const AutomationPack = {
  id: "automation",
  label: "Automation Pack (experimental)",
  description: "Experimental automations (opt-in).",
  defaultEnabled: false,
  init() {},
  ready() {}
};

PackManager.register(AutomationPack);
