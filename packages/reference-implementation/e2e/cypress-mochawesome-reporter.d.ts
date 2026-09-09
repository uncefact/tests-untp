// `cypress-mochawesome-reporter` only ships types for its root export (Cypress.Chainable
// augmentation). Its `/lib` and `/plugin` subpaths — used to wire the reporter into
// setupNodeEvents — have no declarations, so we declare the minimal shapes we call.
declare module 'cypress-mochawesome-reporter/lib' {
  export function beforeRunHook(details: Cypress.BeforeRunDetails): Promise<void>;
  export function afterRunHook(
    results: CypressCommandLine.CypressRunResult | CypressCommandLine.CypressFailedRunResult,
  ): Promise<void>;
}

declare module 'cypress-mochawesome-reporter/plugin' {
  const addMochawesomeReporterPlugin: (on: Cypress.PluginEvents) => void;
  export default addMochawesomeReporterPlugin;
}
