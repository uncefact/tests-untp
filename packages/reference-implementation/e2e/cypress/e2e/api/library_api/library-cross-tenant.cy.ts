import { config } from '../../../support/config';
import { waitForGeneration } from '../../../support/library';

describe('Library API cross-tenant journey', { testIsolation: false }, () => {
  // Fresh per test attempt so a Cypress retry never reuses an alias, key or label.
  let RUN_ID = String(Date.now());
  beforeEach(() => {
    RUN_ID = String(Date.now());
  });
  const SA1 = config.serviceAccounts.sa1;
  const SA2 = config.serviceAccounts.sa2;
  const preserveTenant = config.tenantMode === 'closed';

  let tokenA: string;
  let tokenB: string;
  let subA: string;
  let subB: string;

  function decodeSub(accessToken: string): string {
    return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString()).sub;
  }

  function buildCredentialPayload(issuerDid: string, label: string) {
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/'],
      id: `urn:uuid:e2e-library-cross-tenant-${label}-${RUN_ID}`,
      type: ['DigitalProductPassport', 'VerifiableCredential'],
      issuer: {
        type: ['CredentialIssuer'],
        id: issuerDid,
        name: `E2E Cross Tenant Issuer ${RUN_ID}`,
      },
      credentialSubject: {
        type: ['ProductPassport'],
        id: `https://example.com/products/cross-tenant-${label}-${RUN_ID}`,
      },
    };
  }

  function expectVerified(record: Record<string, any>, generation: number) {
    expect(record.verification.generation).to.eq(generation);
    expect(record.verification.state).to.eq('complete');
    expect(record.verification.summary).to.eq('verified');
    expect(record.verification.checks).to.include({
      retrieval: 'pass',
      decryption: 'pass',
      digest: 'pass',
      proof: 'pass',
      status: 'pass',
      temporal: 'pass',
      schemaConformance: 'pass',
    });
  }

  function hostReachableStorageUri(uri: string): string {
    return uri.replace('storage-service:3334', 'localhost:3334');
  }

  before(() => {
    cy.task('getServiceAccountToken', SA1).then((result: any) => {
      tokenA = result.accessToken;
      subA = decodeSub(tokenA);
      return cy.task('cleanupServiceAccountData', { sub: subA, preserveTenant });
    });
    cy.task('getServiceAccountToken', SA2).then((result: any) => {
      tokenB = result.accessToken;
      subB = decodeSub(tokenB);
      return cy.task('cleanupServiceAccountData', { sub: subB, preserveTenant });
    });
  });

  after(() => {
    cy.task('cleanupServiceAccountData', { sub: subA, preserveTenant });
    cy.task('cleanupServiceAccountData', { sub: subB, preserveTenant });
  });

  it('issues in tenant A, verifies in tenant B, and preserves tenant boundaries', function () {
    if (!config.services.vckit.didWebResolvable) {
      cy.log('Skipped because VCKIT_DID_WEB_RESOLVABLE is not enabled for this stack');
      this.skip();
    }

    let didAId: string;
    let didA: string;
    let nativeCredentialId: string;
    let nativeDetail: Record<string, any>;
    let externalRecordId: string;

    cy.request({
      method: 'POST',
      url: '/api/v1/dids',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        type: 'MANAGED',
        method: 'DID_WEB',
        alias: `e2e-xt-${RUN_ID}`,
        name: `E2E Cross Tenant DID ${RUN_ID}`,
      },
    })
      .then((response) => {
        expect(response.status).to.eq(201);
        didAId = response.body.id;
        didA = response.body.did;
        expect(didA).to.be.a('string');
        return cy.request({
          method: 'POST',
          url: '/api/v1/credentials',
          headers: { Authorization: `Bearer ${tokenA}` },
          body: {
            credentialPayload: buildCredentialPayload(didA, 'issued'),
            credentialType: 'DigitalProductPassport',
            version: '0.6.1',
          },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(201);
        nativeCredentialId = response.body.credentialId;
        expect(nativeCredentialId).to.be.a('string');
        return cy.request({
          method: 'GET',
          url: `/api/v1/library/${nativeCredentialId}`,
          headers: { Authorization: `Bearer ${tokenA}` },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        nativeDetail = response.body;
        expect(nativeDetail.storageUri).to.be.a('string');
        expect(nativeDetail.digestMultibase).to.be.a('string');
        expect(nativeDetail.decryptionKey).to.match(/^[0-9a-f]{64}$/);
        expect(nativeDetail.hasKey).to.eq(true);
        return cy.request({
          method: 'GET',
          url: `/api/v1/dids/${didAId}`,
          headers: { Authorization: `Bearer ${tokenB}` },
          failOnStatusCode: false,
        });
      })
      .then((response) => {
        expect(response.status).to.eq(404);
        return cy.request({
          method: 'GET',
          url: '/api/v1/dids',
          headers: { Authorization: `Bearer ${tokenB}` },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        const foreignDid = response.body.data.find((did: Record<string, any>) => did.did === didA);
        expect(foreignDid).to.not.exist;
        return cy.request({
          method: 'POST',
          url: '/api/v1/credentials',
          headers: { Authorization: `Bearer ${tokenB}` },
          body: {
            credentialPayload: buildCredentialPayload(didA, 'rejected'),
            credentialType: 'DigitalProductPassport',
            version: '0.6.1',
          },
          failOnStatusCode: false,
        });
      })
      .then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.include('not registered to your tenant');
        return cy.request({
          method: 'GET',
          url: `/api/v1/library/${nativeCredentialId}`,
          headers: { Authorization: `Bearer ${tokenB}` },
          failOnStatusCode: false,
        });
      })
      .then((response) => {
        expect(response.status).to.eq(404);
        return cy.request({
          method: 'GET',
          url: '/api/v1/library',
          headers: { Authorization: `Bearer ${tokenB}` },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        const foreignRecord = response.body.data.find((row: Record<string, any>) => row.id === nativeCredentialId);
        expect(foreignRecord).to.not.exist;
        return cy.request({
          method: 'POST',
          url: '/api/v1/library',
          headers: {
            Authorization: `Bearer ${tokenB}`,
            'Idempotency-Key': `e2e-cross-tenant-register-${RUN_ID}`,
          },
          body: {
            sourceUrl: nativeDetail.storageUri,
            sourceEncryption: { decryptionKey: nativeDetail.decryptionKey },
            annotations: {
              displayName: `E2E external copy from tenant A ${RUN_ID}`,
              declaredCredentialType: 'DPP',
            },
          },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(201);
        externalRecordId = response.body.id;
        expect(externalRecordId).to.be.a('string');
        return waitForGeneration(externalRecordId, tokenB, 1);
      })
      .then((record) => {
        expectVerified(record, 1);
        expect(record.credential.issuerDid).to.eq(didA);
        expect(record.origin).to.eq('external');
        expect(record.hasKey).to.eq(true);
        expect(record.decryptionKey).to.be.a('string');
        expect(record.decryptionKey).to.not.eq(nativeDetail.decryptionKey);
        return cy.request({
          method: 'GET',
          url: `/api/v1/library/${externalRecordId}`,
          headers: { Authorization: `Bearer ${tokenB}` },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        const record = response.body as Record<string, any>;
        return cy.request({
          method: 'POST',
          url: '/api/v1/credentials/verify',
          body: {
            uri: hostReachableStorageUri(record.storageUri),
            digestMultibase: record.digestMultibase,
            decryptionKey: record.decryptionKey,
          },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.verified).to.eq(true);
        return cy.request({
          method: 'GET',
          url: `/api/v1/library/${externalRecordId}`,
          headers: { Authorization: `Bearer ${tokenA}` },
          failOnStatusCode: false,
        });
      })
      .then((response) => {
        expect(response.status).to.eq(404);
        return cy.request({
          method: 'GET',
          url: '/api/v1/library',
          headers: { Authorization: `Bearer ${tokenA}` },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        const foreignRecord = response.body.data.find((row: Record<string, any>) => row.id === externalRecordId);
        expect(foreignRecord).to.not.exist;
        return cy.request({
          method: 'POST',
          url: `/api/v1/library/${externalRecordId}/verify`,
          headers: { Authorization: `Bearer ${tokenB}` },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(202);
        return waitForGeneration(externalRecordId, tokenB, 2);
      })
      .then((record) => {
        expectVerified(record, 2);
        return cy.request({
          method: 'DELETE',
          url: `/api/v1/library/${externalRecordId}`,
          headers: { Authorization: `Bearer ${tokenB}` },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(204);
        return cy.request({
          method: 'GET',
          url: `/api/v1/library/${nativeCredentialId}`,
          headers: { Authorization: `Bearer ${tokenA}` },
        });
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        return cy.request({
          method: 'GET',
          url: `/api/v1/library/${externalRecordId}`,
          headers: { Authorization: `Bearer ${tokenB}` },
          failOnStatusCode: false,
        });
      })
      .then((response) => {
        expect(response.status).to.eq(404);
      });
  });
});
