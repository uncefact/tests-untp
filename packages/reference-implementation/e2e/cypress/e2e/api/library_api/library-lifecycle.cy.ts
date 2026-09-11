import { config } from '../../../support/config';
import { waitForGeneration } from '../../../support/library';

describe('Library API lifecycle', { testIsolation: false }, () => {
  // Fresh per test attempt so a Cypress retry never reuses an alias, key or label.
  let RUN_ID = String(Date.now());
  beforeEach(() => {
    RUN_ID = String(Date.now());
  });
  const SA1 = config.serviceAccounts.sa1;
  const preserveTenant = config.tenantMode === 'closed';

  let token: string;
  let sub: string;
  let issuerDid: string;

  function decodeSub(accessToken: string): string {
    return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString()).sub;
  }

  // A current window by default so the temporal check judges real bounds;
  // a credential without bounds is valid indefinitely and also passes.
  function buildCredentialPayload(
    label: string,
    window: { validFrom?: string; validUntil?: string } = {
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2036-01-01T00:00:00Z',
    },
  ) {
    return {
      ...window,
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/'],
      id: `urn:uuid:e2e-library-${label}-${RUN_ID}`,
      type: ['DigitalProductPassport', 'VerifiableCredential'],
      issuer: {
        type: ['CredentialIssuer'],
        id: issuerDid,
        name: `E2E Library Issuer ${RUN_ID}`,
      },
      credentialSubject: {
        type: ['ProductPassport'],
        id: `https://example.com/products/library-${label}-${RUN_ID}`,
      },
    };
  }

  function expectVerified(record: Record<string, any>, generation: number, decryption: 'pass' | 'not_run' = 'pass') {
    expect(record.verification.generation).to.eq(generation);
    expect(record.verification.state).to.eq('complete');
    expect(record.verification.summary).to.eq('verified');
    expect(record.verification.checks).to.include({
      retrieval: 'pass',
      decryption,
      digest: 'pass',
      proof: 'pass',
      status: 'pass',
      temporal: 'pass',
      schemaConformance: 'pass',
    });
  }

  function issueCredential(
    label: string,
    encrypt: boolean,
    window?: { validFrom?: string; validUntil?: string },
  ): Cypress.Chainable<string> {
    return cy
      .request({
        method: 'POST',
        url: '/api/v1/credentials',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          credentialPayload: buildCredentialPayload(label, window),
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          storageOptions: { encrypt },
        },
      })
      .then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
        return response.body.credentialId as string;
      });
  }

  function registerCredential(
    sourceUrl: string,
    label: string,
    sourceDecryptionKey?: string,
  ): Cypress.Chainable<Record<string, any>> {
    return cy
      .request({
        method: 'POST',
        url: '/api/v1/library',
        headers: {
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': `e2e-library-register-${label}-${RUN_ID}`,
        },
        body: {
          sourceUrl,
          ...(sourceDecryptionKey === undefined ? {} : { sourceEncryption: { decryptionKey: sourceDecryptionKey } }),
          annotations: {
            displayName: `E2E library ${label} ${RUN_ID}`,
            declaredCredentialType: 'DPP',
          },
        },
      })
      .then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.id).to.be.a('string');
        return response.body as Record<string, any>;
      });
  }

  before(() => {
    cy.task('getServiceAccountToken', SA1).then((result: any) => {
      token = result.accessToken;
      sub = decodeSub(token);
      cy.task('cleanupServiceAccountData', { sub, preserveTenant });
      cy.request({
        method: 'GET',
        url: '/api/v1/dids',
        headers: { Authorization: `Bearer ${token}` },
      }).then((response) => {
        expect(response.status).to.eq(200);
        const defaultDid = response.body.data.find((did: Record<string, any>) => did.isDefault === true);
        expect(defaultDid).to.exist;
        issuerDid = defaultDid.did;
      });
    });
  });

  after(() => {
    cy.task('cleanupServiceAccountData', { sub, preserveTenant });
  });

  it('registers, verifies, annotates, batch-gets and deletes an external record', () => {
    let targetRecordId: string;
    let survivorRecordId: string;
    let targetVersion: number;

    issueCredential(`target-${RUN_ID}`, false)
      .then((targetCredentialId) => {
        return issueCredential(`survivor-${RUN_ID}`, false).then((survivorCredentialId) => {
          return { targetCredentialId, survivorCredentialId };
        });
      })
      .then(({ targetCredentialId, survivorCredentialId }) => {
        return cy
          .request({
            method: 'GET',
            url: `/api/v1/library/${targetCredentialId}`,
            headers: { Authorization: `Bearer ${token}` },
          })
          .then((targetResponse) => {
            expect(targetResponse.status).to.eq(200);
            expect(targetResponse.body.decryptionKey).to.be.null;
            return cy
              .request({
                method: 'GET',
                url: `/api/v1/library/${survivorCredentialId}`,
                headers: { Authorization: `Bearer ${token}` },
              })
              .then((survivorResponse) => {
                expect(survivorResponse.status).to.eq(200);
                return {
                  targetSourceUrl: targetResponse.body.storageUri as string,
                  survivorSourceUrl: survivorResponse.body.storageUri as string,
                };
              });
          });
      })
      .then(({ targetSourceUrl, survivorSourceUrl }) => {
        return registerCredential(targetSourceUrl, `target-${RUN_ID}`).then((targetRegistration) => {
          targetRecordId = targetRegistration.id;
          return registerCredential(survivorSourceUrl, `survivor-${RUN_ID}`).then((survivorRegistration) => {
            survivorRecordId = survivorRegistration.id;
          });
        });
      })
      .then(() => waitForGeneration(targetRecordId, token, 1))
      .then((record) => {
        expect(record.origin).to.eq('external');
        expect(record.hasKey).to.eq(true);
        expect(record.decryptionKey).to.be.a('string');
        expectVerified(record, 1);
      })
      .then(() =>
        cy.request({
          method: 'POST',
          url: `/api/v1/library/${targetRecordId}/verify`,
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(202);
      })
      .then(() => waitForGeneration(targetRecordId, token, 2))
      .then((record) => {
        expectVerified(record, 2);
        targetVersion = record.annotations.annotationVersion;
      })
      .then(() =>
        cy.request({
          method: 'PATCH',
          url: `/api/v1/library/${targetRecordId}`,
          headers: {
            Authorization: `Bearer ${token}`,
            'If-Version': String(targetVersion),
          },
          body: {
            displayName: `Updated library target ${RUN_ID}`,
            notes: `Updated by lifecycle test ${RUN_ID}`,
          },
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.annotations.displayName).to.eq(`Updated library target ${RUN_ID}`);
        expect(response.body.annotations.notes).to.eq(`Updated by lifecycle test ${RUN_ID}`);
      })
      .then(() =>
        cy.request({
          method: 'GET',
          url: `/api/v1/library/${targetRecordId}`,
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.annotations.displayName).to.eq(`Updated library target ${RUN_ID}`);
        expect(response.body.annotations.notes).to.eq(`Updated by lifecycle test ${RUN_ID}`);
        targetVersion = response.body.annotations.annotationVersion;
      })
      .then(() =>
        cy.request({
          method: 'GET',
          url: '/api/v1/library',
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(200);
        const target = response.body.data.find((row: Record<string, any>) => row.id === targetRecordId);
        expect(target).to.exist;
        expect(target.annotations.displayName).to.eq(`Updated library target ${RUN_ID}`);
      })
      .then(() =>
        cy.request({
          method: 'PATCH',
          url: `/api/v1/library/${targetRecordId}`,
          headers: {
            Authorization: `Bearer ${token}`,
            'If-Version': String(targetVersion - 1),
          },
          body: { notes: 'stale version must not win' },
          failOnStatusCode: false,
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(409);
        expect(response.body.code).to.eq('VERSION_CONFLICT');
      })
      .then(() =>
        cy.request({
          method: 'POST',
          url: '/api/v1/library/batch-get',
          headers: { Authorization: `Bearer ${token}` },
          body: { ids: [targetRecordId, 'no-such-id'] },
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.have.length(1);
        expect(response.body.data[0].id).to.eq(targetRecordId);
        expect(response.body.failures).to.have.length(1);
        expect(response.body.failures[0].id).to.eq('no-such-id');
      })
      .then(() =>
        cy.request({
          method: 'DELETE',
          url: `/api/v1/library/${targetRecordId}`,
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(204);
        expect(response.body).to.be.empty;
      })
      .then(() =>
        cy.request({
          method: 'GET',
          url: `/api/v1/library/${targetRecordId}`,
          headers: { Authorization: `Bearer ${token}` },
          failOnStatusCode: false,
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(404);
      })
      .then(() =>
        cy.request({
          method: 'GET',
          url: '/api/v1/library',
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(200);
        const deleted = response.body.data.find((row: Record<string, any>) => row.id === targetRecordId);
        expect(deleted).to.not.exist;
      })
      .then(() =>
        cy.request({
          method: 'DELETE',
          url: `/api/v1/library/${targetRecordId}`,
          headers: { Authorization: `Bearer ${token}` },
          failOnStatusCode: false,
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(204);
        expect(response.body).to.be.empty;
      })
      .then(() =>
        cy.request({
          method: 'GET',
          url: `/api/v1/library/${survivorRecordId}`,
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(survivorRecordId);
      });
  });

  it('settles an expired but genuine credential as verified with a failed temporal check', () => {
    // Verified means authentic, untampered with and not revoked; expiry is
    // evidence, not a block. The provider may not enforce the validity
    // window for this envelope format, so the worker judges it from the
    // credential's own claims. Fails if an expired credential reads
    // temporal pass, or if proof is not established for it.
    let recordId: string;
    issueCredential(`expired-${RUN_ID}`, false, {
      validFrom: '2020-01-01T00:00:00Z',
      validUntil: '2021-01-01T00:00:00Z',
    })
      .then((credentialId) =>
        cy.request({
          method: 'GET',
          url: `/api/v1/library/${credentialId}`,
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((response) => registerCredential(response.body.storageUri, `expired-${RUN_ID}`))
      .then((registration) => {
        recordId = registration.id;
        return waitForGeneration(recordId, token, 1);
      })
      .then((record) => {
        expect(record.verification.state).to.eq('complete');
        expect(record.verification.summary).to.eq('verified');
        expect(record.verification.checks).to.include({
          retrieval: 'pass',
          digest: 'pass',
          proof: 'pass',
          status: 'pass',
          temporal: 'fail',
        });
        expect(record.currencyStatus).to.eq('expired');
      });
  });

  it('recovers an encrypted external source when its key arrives on re-verification', () => {
    let sourceUrl: string;
    let sourceKey: string;
    let recordId: string;

    issueCredential(`recovery-${RUN_ID}`, true)
      .then((credentialId) =>
        cy
          .request({
            method: 'GET',
            url: `/api/v1/library/${credentialId}`,
            headers: { Authorization: `Bearer ${token}` },
          })
          .then((response) => {
            expect(response.status).to.eq(200);
            sourceUrl = response.body.storageUri;
            sourceKey = response.body.decryptionKey;
            expect(sourceKey).to.match(/^[0-9a-f]{64}$/);
          }),
      )
      .then(() => registerCredential(sourceUrl, `recovery-${RUN_ID}`))
      .then((registration) => {
        recordId = registration.id;
        expect(registration.verification.generation).to.eq(1);
        expect(registration.verification.state).to.eq('failed');
        expect(registration.verification.summary).to.eq('failed');
        expect(registration.verification.checks).to.include({
          retrieval: 'pass',
          decryption: 'fail',
          digest: 'not_run',
          proof: 'not_run',
          status: 'not_run',
          temporal: 'not_run',
          schemaConformance: 'not_run',
        });
        expect(registration.verification.failure.code).to.eq('DECRYPTION_REQUIRED');
      })
      .then(() =>
        cy.request({
          method: 'POST',
          url: `/api/v1/library/${recordId}/verify`,
          headers: { Authorization: `Bearer ${token}` },
          body: { sourceEncryption: { decryptionKey: sourceKey } },
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(202);
      })
      .then(() => waitForGeneration(recordId, token, 2))
      .then((record) => {
        expectVerified(record, 2);
        expect(record.hasKey).to.eq(true);
        expect(record.decryptionKey).to.be.a('string');
        expect(record.decryptionKey).to.not.eq(sourceKey);
      });
  });
});
