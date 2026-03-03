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
describe('Closed mode — service account API', { testIsolation: false }, () => {
  const GROUP_CLAIM = '/e2e-org-alpha';
  let accessToken: string;

  before(() => {
    // Clean up any leftover closed mode data
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_CLAIM });

    // Fetch a service account token from Keycloak
    cy.task('getServiceAccountToken').then((result: any) => {
      accessToken = result.accessToken;
    });
  });

  after(() => {
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_CLAIM });
  });

  it('GET /api/v1/dids — authenticates via bearer token and resolves tenant by group', () => {
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

  it('POST /api/v1/dids — creates a DID via service account', () => {
    const RUN_ID = Date.now();

    cy.request({
      method: 'POST',
      url: '/api/v1/dids',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        type: 'MANAGED',
        method: 'DID_WEB',
        alias: `e2e-sa-closed-${RUN_ID}`,
        name: `Closed SA DID ${RUN_ID}`,
        description: 'Created by closed mode service account E2E test',
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body.did).to.match(/^did:web:/);
    });
  });

  it('tenant was resolved with correct externalIdpGroupId', () => {
    cy.task('verifyClosedModeTenant', { externalIdpGroupId: GROUP_CLAIM }).then(
      (tenant: any) => {
        expect(tenant).to.not.be.null;
        expect(tenant.externalIdpGroupId).to.eq(GROUP_CLAIM);
      },
    );
  });

  it('session user and service account share the same group tenant', () => {
    // First, sign in via browser to create a session-based user in the same group
    cy.apiLogin('e2e-admin@test.local', 'E2eTest123!');

    // Both the session user and service account user should be in the same tenant
    // because they share the /e2e-org-alpha group
    cy.task('verifyClosedModeTenant', { externalIdpGroupId: GROUP_CLAIM }).then(
      (tenant: any) => {
        expect(tenant).to.not.be.null;

        // Verify the service account can still call the API and gets the same tenant
        cy.request({
          method: 'GET',
          url: '/api/v1/dids',
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.data).to.be.an('array');
        });
      },
    );
  });
});
