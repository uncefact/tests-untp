// `cypress-mochawesome-reporter` only ships types for its root export (Cypress.Chainable
// augmentation). Its `/lib` subpath — used to wire the reporter into setupNodeEvents —
// has no declaration, so we declare the minimal shape we call.
declare module 'cypress-mochawesome-reporter/lib' {
  export function beforeRunHook(details: Cypress.BeforeRunDetails): Promise<void>;
  export function afterRunHook(
    results: CypressCommandLine.CypressRunResult | CypressCommandLine.CypressFailedRunResult,
  ): Promise<void>;
}
