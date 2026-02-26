/**
 * Closed mode CRUD E2E tests.
 *
 * Proves that the full API stack works when the app runs with
 * TENANT_MODE=closed.  Exercises a DID create/list/get flow to verify
 * that withTenantAuth resolves the correct tenant from the session.
 *
 * Requires: docker-compose.e2e-closed.yml overlay
 */
describe('Closed mode — DID CRUD', { testIsolation: false }, () => {
  const GROUP_CLAIM = '/e2e-org-alpha';
  const ADMIN_EMAIL = 'e2e-admin@test.local';
  const PASSWORD = 'E2eTest123!';
  const RUN_ID = Date.now();
  let createdDidId: string;

  before(() => {
    // Clean up any leftover data from previous runs
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_CLAIM });

    // Login — triggers closed mode tenant provisioning
    cy.apiLogin(ADMIN_EMAIL, PASSWORD);
  });

  after(() => {
    cy.task('cleanupClosedModeData', { externalIdpGroupId: GROUP_CLAIM });
  });

  it('POST /api/v1/dids — creates a managed DID', () => {
    cy.request({
      method: 'POST',
      url: '/api/v1/dids',
      body: {
        type: 'MANAGED',
        method: 'DID_WEB',
        alias: `e2e-closed-${RUN_ID}`,
        name: `Closed Mode DID ${RUN_ID}`,
        description: 'Created by closed mode E2E test',
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body.ok).to.be.true;
      expect(response.body.did.did).to.match(/^did:web:/);
      expect(response.body.did.type).to.eq('MANAGED');
      expect(response.body.did.status).to.eq('ACTIVE');

      createdDidId = response.body.did.id;
    });
  });

  it('GET /api/v1/dids — lists DIDs including the one just created', () => {
    cy.request('/api/v1/dids').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.ok).to.be.true;
      expect(response.body.dids).to.be.an('array');

      const found = response.body.dids.find((d: any) => d.id === createdDidId);
      expect(found).to.exist;
    });
  });

  it('GET /api/v1/dids/:id — retrieves the specific DID', () => {
    cy.request(`/api/v1/dids/${createdDidId}`).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.ok).to.be.true;
      expect(response.body.did.id).to.eq(createdDidId);
      expect(response.body.did.name).to.eq(`Closed Mode DID ${RUN_ID}`);
    });
  });
});
