/**
 * Typed config helper for playground E2E specs.
 *
 * Reads values from Cypress.env() which are populated by the env block in
 * cypress.config.ts. Do NOT import this file from cypress.config.ts or any
 * Node.js task; those should read from process.env directly.
 */
export const config = {
  playground: {
    baseUrl: (Cypress.env('PLAYGROUND_BASE_URL') || 'http://localhost:4000') as string,
  },
};
