/**
 * Closed mode tenant resolution E2E tests.
 *
 * Verifies that when the app runs with TENANT_MODE=closed, signing in
 * via Keycloak auto-provisions a tenant from the user's group claim
 * and subsequent API calls succeed.
 *
 * Requires: docker-compose.e2e-closed.yml overlay
 */
import { config, runTag } from '../../support/config';

describe('Closed mode  -  tenant resolution', { testIsolation: false }, () => {
  const GROUP_CLAIM = config.groups.alpha;
  const ADMIN_EMAIL = config.user.email;
  const ADMIN_PASSWORD = config.user.password;
  const USER_EMAIL = config.user2.email;
  const USER_PASSWORD = config.user2.password || config.user.password;
  const RUN_ID = runTag();
  let adminDidId: string;

  before(() => {});

  describe('First user sign-in provisions tenant', () => {
    it('admin signs in and can call the API', () => {
      cy.apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD);

      // The sign-in event should have auto-provisioned a tenant from the
      // group claim.  Verify the session works by hitting a protected endpoint.
      cy.request('/api/v1/dids').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
      });
    });

    it(`the provisioned tenant holds what the admin creates (${GROUP_CLAIM})`, () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        body: {
          type: 'MANAGED',
          method: 'DID_WEB',
          alias: `e2e-closed-resolution-${RUN_ID}-r${Cypress.currentRetry}`,
          name: `Closed resolution DID ${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        adminDidId = response.body.id;
        cy.request(`/api/v1/dids/${adminDidId}`).then((read) => {
          expect(read.status).to.eq(200);
          expect(read.body.id).to.eq(adminDidId);
        });
      });
    });
  });

  describe('Second user joins same tenant', () => {
    it('second user signs in (same group) and can call the API', () => {
      // Clear all cookies to reset both app and Keycloak sessions
      cy.clearAllCookies();

      cy.apiLogin(USER_EMAIL, USER_PASSWORD);

      cy.request('/api/v1/dids').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
      });
    });

    it('both users share the same tenant: the second user reads the DID the admin created', () => {
      cy.request(`/api/v1/dids/${adminDidId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(adminDidId);
      });
    });
  });
});
