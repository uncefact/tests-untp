/**
 * Open mode service account E2E tests.
 *
 * Verifies that when the app runs in open mode (default), API calls
 * with a Bearer token (service account) are authenticated via the
 * middleware header-forwarding path and the service account user
 * is auto-provisioned with its own tenant.
 *
 * Requires: docker-compose.e2e.yml (standard E2E stack)
 */
import { config, runTag } from '../../support/config';

describe('Open mode  -  service account API', { testIsolation: false }, () => {
  let accessToken: string;
  let createdDidId: string;

  before(() => {
    // Fetch a service account token from Keycloak
    cy.task('getServiceAccountToken').then((result: any) => {
      accessToken = result.accessToken;
    });
  });

  it('GET /api/v1/dids  -  authenticates and resolves the service account to a tenant', () => {
    cy.request({
      method: 'GET',
      url: '/api/v1/dids',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.data).to.be.an('array');
      expect(response.body.pagination).to.exist;
    });
  });

  it('POST /api/v1/dids  -  creates a DID via service account', () => {
    const RUN_ID = runTag();

    cy.request({
      method: 'POST',
      url: '/api/v1/dids',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        type: 'MANAGED',
        method: 'DID_WEB',
        alias: `e2e-sa-open-${RUN_ID}`,
        name: `Open SA DID ${RUN_ID}`,
        description: `Created by open mode service account E2E test ${RUN_ID}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body.did).to.match(/^did:web:/);
      createdDidId = response.body.id;
    });
  });

  it('the provisioned tenant holds the DID the service account created', () => {
    cy.request({
      method: 'GET',
      url: `/api/v1/dids/${createdDidId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.id).to.eq(createdDidId);
    });
  });
});
