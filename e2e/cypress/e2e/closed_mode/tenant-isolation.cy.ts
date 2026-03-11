/**
 * Closed mode tenant isolation E2E tests.
 *
 * Verifies that in closed mode, two service accounts assigned to different
 * Keycloak groups are resolved to separate tenants and cannot see each
 * other's resources.
 *
 * SA1 (ri-service-account-e2e) → /e2e-org-alpha
 * SA2 (ri-service-account-e2e-2) → /e2e-org-beta
 *
 * Requires: docker-compose.e2e-closed.yml overlay (TENANT_MODE=closed)
 */
describe('Closed mode — tenant isolation', { testIsolation: false }, () => {
  const SA1 = { clientId: 'ri-service-account-e2e', clientSecret: 'e2e-service-account-secret' };
  const SA2 = { clientId: 'ri-service-account-e2e-2', clientSecret: 'e2e-service-account-secret-2' };
  const GROUP_ALPHA = '/e2e-org-alpha';
  const GROUP_BETA = '/e2e-org-beta';

  let token1: string;
  let token2: string;
  let did1Id: string;

  before(() => {
    // Clean up both groups' data
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_ALPHA });
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_BETA });

    // Get tokens for both service accounts
    cy.task('getServiceAccountToken', SA1).then((result: any) => {
      token1 = result.accessToken;
    });

    cy.task('getServiceAccountToken', SA2).then((result: any) => {
      token2 = result.accessToken;
    });
  });

  after(() => {
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_ALPHA });
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_BETA });
  });

  it('SA1 (alpha) creates a DID', () => {
    const RUN_ID = Date.now();

    cy.request({
      method: 'POST',
      url: '/api/v1/dids',
      headers: { Authorization: `Bearer ${token1}` },
      body: {
        type: 'MANAGED',
        method: 'DID_WEB',
        alias: `e2e-iso-closed-alpha-${RUN_ID}`,
        name: `Closed Isolation Alpha DID ${RUN_ID}`,
        description: 'Created by SA1 (alpha) for closed mode isolation test',
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body.did).to.match(/^did:web:/);
      did1Id = response.body.id;
    });
  });

  it('SA1 (alpha) can see its own DID', () => {
    cy.request({
      method: 'GET',
      url: '/api/v1/dids',
      headers: { Authorization: `Bearer ${token1}` },
    }).then((response) => {
      expect(response.status).to.eq(200);
      const found = response.body.data.find((d: any) => d.id === did1Id);
      expect(found, 'SA1 should see its own DID').to.exist;
    });
  });

  it('SA2 (beta) cannot see SA1 (alpha) DID in list', () => {
    cy.request({
      method: 'GET',
      url: '/api/v1/dids',
      headers: { Authorization: `Bearer ${token2}` },
    }).then((response) => {
      expect(response.status).to.eq(200);
      const found = response.body.data.find((d: any) => d.id === did1Id);
      expect(found, 'SA2 must NOT see SA1 DID').to.not.exist;
    });
  });

  it('SA2 (beta) cannot access SA1 (alpha) DID by ID', () => {
    cy.request({
      method: 'GET',
      url: `/api/v1/dids/${did1Id}`,
      headers: { Authorization: `Bearer ${token2}` },
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(404);
    });
  });

  it('SA2 (beta) cannot update SA1 (alpha) DID', () => {
    cy.request({
      method: 'PATCH',
      url: `/api/v1/dids/${did1Id}`,
      headers: { Authorization: `Bearer ${token2}` },
      body: { name: 'Hijacked DID' },
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(404);
    });
  });

  it('SA2 (beta) cannot delete SA1 (alpha) DID', () => {
    cy.request({
      method: 'DELETE',
      url: `/api/v1/dids/${did1Id}`,
      headers: { Authorization: `Bearer ${token2}` },
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(404);
    });
  });

  it('tenants were resolved to separate groups', () => {
    cy.task('verifyClosedModeTenant', { externalIdpGroupId: GROUP_ALPHA }).then(
      (alpha: any) => {
        expect(alpha).to.not.be.null;
        expect(alpha.externalIdpGroupId).to.eq(GROUP_ALPHA);
      },
    );

    cy.task('verifyClosedModeTenant', { externalIdpGroupId: GROUP_BETA }).then(
      (beta: any) => {
        expect(beta).to.not.be.null;
        expect(beta.externalIdpGroupId).to.eq(GROUP_BETA);
      },
    );
  });

  it('confirms SA1 DID is unmodified after SA2 attack attempts', () => {
    cy.request({
      method: 'GET',
      url: `/api/v1/dids/${did1Id}`,
      headers: { Authorization: `Bearer ${token1}` },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.id).to.eq(did1Id);
      expect(response.body.name).to.not.eq('Hijacked DID');
    });
  });
});
