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
import { readV070CredentialPayload } from '../../support/v0.7-credential-payload';

// This block signs out between users and runs last under testIsolation: false.
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

  describe('Session user with no group assignment is refused', () => {
    const ORPHAN_EMAIL = 'e2e-orphan@test.local';
    const ORPHAN_PASSWORD = config.user.password;
    const ORPHAN_ISSUER_DID = 'did:web:orphan.example';
    const VALID_FROM = new Date().toISOString();
    const VALID_UNTIL = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

    it('returns the closed-mode no-group refusal for DIDs and both credential batch routes', () => {
      // Closed mode provisions a tenant for any group claim on both the session sign-in and bearer paths, so an unmapped group is not refused.
      // The reachable session-path refusal is a principal whose token carries no group claim.
      cy.clearAllCookies();
      // A principal with no group assignment owns no rows and is refused on every route, so it cannot act as a cleanup actor.
      cy.apiLogin(ORPHAN_EMAIL, ORPHAN_PASSWORD, { cleanupActor: false });

      cy.request({ method: 'GET', url: '/api/v1/dids', failOnStatusCode: false }).then((response) => {
        expect(response.status).to.eq(403);
        expect(response.body).to.deep.eq({ error: 'No group assignment found' });
      });

      readV070CredentialPayload({
        templateDir: 'digital_product_passport',
        credentialId: `urn:uuid:e2e-closed-orphan-${RUN_ID}`,
        issuerDid: ORPHAN_ISSUER_DID,
        validFrom: VALID_FROM,
        validUntil: VALID_UNTIL,
      }).then((credentialPayload) => {
        const batchBody = {
          items: [
            {
              credentialType: 'DigitalProductPassport',
              version: '0.7.0',
              statusPurposes: ['revocation'],
              credentialPayload,
            },
          ],
        };

        cy.request({
          method: 'POST',
          url: '/api/v1/credentials/batches',
          headers: { 'Idempotency-Key': `e2e-closed-orphan-batch-${RUN_ID}` },
          body: batchBody,
          failOnStatusCode: false,
        })
          .then((response) => {
            expect(response.status).to.eq(403);
            expect(response.body).to.deep.eq({ error: 'No group assignment found' });
          })
          .then(() =>
            cy
              .request({
                method: 'GET',
                url: '/api/v1/credentials/batches/anything',
                failOnStatusCode: false,
              })
              .then((response) => {
                expect(response.status).to.eq(403);
                expect(response.body).to.deep.eq({ error: 'No group assignment found' });
              })
              .then(() => cy.clearAllCookies()),
          );
      });
    });
  });
});
