/**
 * Typed config helper for browser-side test specs.
 *
 * Reads values from Cypress.env() which are populated by the env block
 * in cypress.config.ts. Do NOT import this file from cypress.config.ts
 * or any Node.js task — those should read from config.env.* directly.
 */
export const config = {
  idp: {
    provider: Cypress.env('IDP_PROVIDER') as 'keycloak' | 'zitadel',
    baseUrl: Cypress.env('IDP_BASE_URL') as string,
    realm: Cypress.env('IDP_REALM') as string,
    clientId: Cypress.env('IDP_CLIENT_ID') as string,
    clientSecret: Cypress.env('IDP_CLIENT_SECRET') as string,
    audience: Cypress.env('IDP_AUDIENCE') as string,
  },
  user: {
    email: Cypress.env('USER_EMAIL') as string,
    password: Cypress.env('USER_PASSWORD') as string,
  },
  user2: {
    email: Cypress.env('USER2_EMAIL') as string,
  },
  serviceAccounts: {
    sa1: {
      clientId: Cypress.env('SA1_CLIENT_ID') as string,
      clientSecret: Cypress.env('SA1_CLIENT_SECRET') as string,
    },
    sa2: {
      clientId: Cypress.env('SA2_CLIENT_ID') as string,
      clientSecret: Cypress.env('SA2_CLIENT_SECRET') as string,
    },
  },
  services: {
    vckit: {
      baseUrl: Cypress.env('VCKIT_BASE_URL') as string,
      apiKey: Cypress.env('VCKIT_API_KEY') as string,
    },
    storage: {
      baseUrl: Cypress.env('STORAGE_BASE_URL') as string,
      apiKey: Cypress.env('STORAGE_API_KEY') as string,
      apiVersion: Cypress.env('STORAGE_API_VERSION') as string,
      publicBucket: Cypress.env('STORAGE_PUBLIC_BUCKET') as string,
      privateBucket: Cypress.env('STORAGE_PRIVATE_BUCKET') as string,
    },
  },
  playground: {
    baseUrl: (Cypress.env('PLAYGROUND_BASE_URL') || 'http://localhost:4000') as string,
  },
  tenantMode: (Cypress.env('TENANT_MODE') || 'open') as 'open' | 'closed',
  testOrg: {
    id: Cypress.env('TEST_ORG_ID') as string,
  },
  groups: {
    alpha: Cypress.env('GROUP_ALPHA') as string,
    beta: Cypress.env('GROUP_BETA') as string,
  },
};
