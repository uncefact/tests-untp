/**
 * Open mode tenant isolation E2E tests.
 *
 * Verifies that in open mode, two different service accounts are
 * auto-provisioned into separate tenants and cannot see each other's
 * resources. Each service account's `sub` claim produces a unique tenant.
 *
 * Requires: docker-compose.e2e.yml (standard E2E stack, TENANT_MODE=open)
 */
describe('Open mode — tenant isolation', { testIsolation: false }, () => {
  const SA1 = { clientId: 'ri-service-account-e2e', clientSecret: 'e2e-service-account-secret' };
  const SA2 = { clientId: 'ri-service-account-e2e-2', clientSecret: 'e2e-service-account-secret-2' };

  let token1: string;
  let token2: string;
  let sub1: string;
  let sub2: string;
  let did1Id: string;

  function decodeSub(token: string): string {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).sub;
  }

  before(() => {
    // Get tokens for both service accounts
    cy.task('getServiceAccountToken', SA1).then((result: any) => {
      token1 = result.accessToken;
      sub1 = decodeSub(token1);
      cy.task('cleanupServiceAccountData', { sub: sub1 });
    });

    cy.task('getServiceAccountToken', SA2).then((result: any) => {
      token2 = result.accessToken;
      sub2 = decodeSub(token2);
      cy.task('cleanupServiceAccountData', { sub: sub2 });
    });
  });

  after(() => {
    cy.task('cleanupServiceAccountData', { sub: sub1 });
    cy.task('cleanupServiceAccountData', { sub: sub2 });
  });

  it('SA1 creates a DID', () => {
    const RUN_ID = Date.now();

    cy.request({
      method: 'POST',
      url: '/api/v1/dids',
      headers: { Authorization: `Bearer ${token1}` },
      body: {
        type: 'MANAGED',
        method: 'DID_WEB',
        alias: `e2e-iso-open-sa1-${RUN_ID}`,
        name: `Open Isolation SA1 DID ${RUN_ID}`,
        description: 'Created by SA1 for open mode isolation test',
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body.did).to.match(/^did:web:/);
      did1Id = response.body.id;
    });
  });

  it('SA1 can see its own DID', () => {
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

  it('SA2 cannot see SA1 DID', () => {
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

  it('SA2 cannot access SA1 DID by ID', () => {
    cy.request({
      method: 'GET',
      url: `/api/v1/dids/${did1Id}`,
      headers: { Authorization: `Bearer ${token2}` },
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(404);
    });
  });

  it('SA2 cannot update SA1 DID', () => {
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

  it('SA2 cannot delete SA1 DID', () => {
    cy.request({
      method: 'DELETE',
      url: `/api/v1/dids/${did1Id}`,
      headers: { Authorization: `Bearer ${token2}` },
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(404);
    });
  });

  it('confirms SA1 and SA2 are in separate tenants', () => {
    // SA1's DID should still exist — SA2's delete attempt must have been rejected
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
