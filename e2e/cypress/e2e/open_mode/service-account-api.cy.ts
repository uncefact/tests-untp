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
describe('Open mode — service account API', { testIsolation: false }, () => {
  let accessToken: string;
  let tokenSub: string;

  before(() => {
    // Fetch a service account token from Keycloak
    cy.task('getServiceAccountToken').then((result: any) => {
      accessToken = result.accessToken;

      // Decode the JWT payload to extract the sub claim for cleanup
      const payload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString(),
      );
      tokenSub = payload.sub;

      // Clean up any leftover data from previous runs
      cy.task('cleanupServiceAccountData', { sub: tokenSub });
    });
  });

  after(() => {
    cy.task('cleanupServiceAccountData', { sub: tokenSub });
  });

  it('GET /api/v1/dids — authenticates and auto-provisions tenant', () => {
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
        alias: `e2e-sa-open-${RUN_ID}`,
        name: `Open SA DID ${RUN_ID}`,
        description: 'Created by open mode service account E2E test',
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body.did).to.match(/^did:web:/);
    });
  });

  it('verifies the service account user was auto-provisioned with a tenant', () => {
    cy.task('cleanupServiceAccountData', { sub: tokenSub }).then((result: any) => {
      // This is a verification step — if result is not null, the user+tenant were provisioned
      expect(result).to.not.be.null;
      expect(result.userId).to.be.a('string');
      expect(result.tenantId).to.be.a('string');
    });
  });
});
