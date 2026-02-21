import { PackManager } from "../../framework/packs.js";

export const IntegrationsPack = {
  id: "integrations",
  label: "Integrations Pack",
  description: "Opt-in integrations with external modules.",
  defaultEnabled: false,
  init() {},
  ready() {}
};

PackManager.register(IntegrationsPack);
