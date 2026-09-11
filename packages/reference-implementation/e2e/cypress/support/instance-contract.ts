export const E2E_TAG_PREFIX = 'e2e-';

export function runTag(): string {
  const runId = Cypress.env('RUN_ID');
  if (typeof runId !== 'string' || !/^\d{10,}$/.test(runId)) {
    throw new Error('The Cypress RUN_ID capability must be a numeric run id with at least 10 digits.');
  }
  return `${E2E_TAG_PREFIX}${runId}`;
}

export function requireDbAccess(context: Mocha.Context, reason: string): void {
  if (Cypress.env('E2E_DB_ACCESS') === true) return;

  Cypress.log({
    name: 'E2E capability skip',
    message: `E2E_DB_ACCESS=false: ${reason}`,
  });
  context.skip();
}

/**
 * Skips a case that depends on the e2e Keycloak realm fixture (its named
 * clients, users and groups) when the instance under test is not running
 * that realm. A deployed instance declares `E2E_IDP_E2E_REALM=false`.
 */
export function requireE2eRealm(context: Mocha.Context, reason: string): void {
  if (Cypress.env('E2E_IDP_E2E_REALM') === true) return;

  Cypress.log({
    name: 'E2E capability skip',
    message: `E2E_IDP_E2E_REALM=false: ${reason}`,
  });
  context.skip();
}
