/**
 * Closed mode service account E2E tests.
 *
 * Verifies that when the app runs with TENANT_MODE=closed, API calls
 * with a Bearer token (service account) are authenticated via direct
 * token validation, the group claim is extracted, and the tenant is
 * resolved by externalIdpGroupId.
 *
 * Requires: docker-compose.e2e-closed.yml overlay
 */
import { config, runTag } from '../../support/config';

describe('Closed mode: service account API', { testIsolation: false }, () => {
  const GROUP_CLAIM = config.groups.alpha;
  let accessToken: string;
  let createdDidId: string;

  before(() => {
    // Fetch a service account token
    cy.task('getServiceAccountToken').then((result: any) => {
      accessToken = result.accessToken;
    });
  });

  it('GET /api/v1/dids: authenticates via bearer token and resolves tenant by group', () => {
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

  it('POST /api/v1/dids: creates a DID via service account', () => {
    const RUN_ID = runTag();

    cy.request({
      method: 'POST',
      url: '/api/v1/dids',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        type: 'MANAGED',
        method: 'DID_WEB',
        alias: `e2e-sa-closed-${RUN_ID}`,
        name: `Closed SA DID ${RUN_ID}`,
        description: `Created by closed mode service account E2E test ${RUN_ID}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body.did).to.match(/^did:web:/);
      createdDidId = response.body.id;
    });
  });

  it(`the group's user (${GROUP_CLAIM}) shares the tenant the service account resolved`, () => {
    // Last in this spec: a session cookie rides on every later cy.request and
    // would answer as the user rather than the bearer token.
    cy.apiLogin(config.user.email, config.user.password);
    cy.request(`/api/v1/dids/${createdDidId}`).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.id).to.eq(createdDidId);
    });
    cy.clearCookies();
  });
});
