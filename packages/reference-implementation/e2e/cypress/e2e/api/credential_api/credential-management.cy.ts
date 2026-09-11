import { config, requireDbAccess, runTag } from '../../../support/config';

describe('Credential API', { testIsolation: false }, () => {
  const RUN_ID = runTag();
  let testTenantId: string;
  let defaultDidValue: string;
  let tenantDidValue: string;
  let encryptedCredentialId: string;
  let unencryptedCredentialId: string;
  let publishedCredentialId: string;

  /**
   * Builds a minimal valid CredentialPayload conforming to the DPP v0.6.1 schema.
   */
  function buildCredentialPayload(issuerDid: string) {
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/'],
      id: `urn:uuid:e2e-${RUN_ID}`,
      type: ['DigitalProductPassport', 'VerifiableCredential'],
      issuer: {
        type: ['CredentialIssuer'],
        id: issuerDid,
        name: `E2E Test Issuer ${RUN_ID}`,
      },
      credentialSubject: {
        type: ['ProductPassport'],
        id: `https://example.com/products/e2e-${RUN_ID}`,
      },
    };
  }

  before(function () {
    requireDbAccess(this, 'This suite uses Postgres tenant and user fixtures, including native credential cleanup.');
    // Clean up any stale data from a previous failed run
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });
    cy.task('cleanupTestUsers', { emails: [config.user.email, config.user2.email] });

    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: config.user.email }).then((result: any) => {
      testTenantId = result.tenantId;
    });

    // Create VC service instance (required for signing credentials)
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: `E2E VCKit VC ${RUN_ID}`,
        config: {
          baseUrl: config.services.vckit.baseUrl,
          apiKey: config.services.vckit.apiKey,
        },
        apiVersion: '1.0.0',
        isPrimary: true,
      },
    }).then((res) => {
      expect(res.status).to.eq(201);
    });

    // Create STORAGE service instance (required for storing credentials)
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'STORAGE',
        adapterType: 'UNCEFACT_STORAGE',
        name: `E2E Storage ${RUN_ID}`,
        config: {
          baseUrl: config.services.storage.baseUrl,
          apiKey: config.services.storage.apiKey,
          apiVersion: config.services.storage.apiVersion,
          publicBucket: config.services.storage.publicBucket,
          privateBucket: config.services.storage.privateBucket,
        },
        apiVersion: '3.1.0',
        isPrimary: true,
      },
    }).then((res) => {
      expect(res.status).to.eq(201);
    });
  });

  after(() => {
    if (config.capabilities.dbAccess) {
      const preserveTenant = config.tenantMode === 'closed';
      cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
    }
  });

  // -----------------------------------------------------------------------
  // DID ownership enforcement
  // -----------------------------------------------------------------------
  describe('DID ownership enforcement', () => {
    let foreignDid: string;

    before(() => {
      // Look up the system default DID
      cy.request('/api/v1/dids').then((response) => {
        expect(response.status).to.eq(200);
        const defaultDid = response.body.data.find((d: any) => d.isDefault === true);
        expect(defaultDid).to.exist;
        defaultDidValue = defaultDid.did;
      });

      // Create a tenant-owned MANAGED DID when the configured instance can
      // resolve did:web documents over HTTPS during signing.
      if (config.services.vckit.didWebResolvable) {
        cy.request({
          method: 'POST',
          url: '/api/v1/dids',
          body: {
            type: 'MANAGED',
            method: 'DID_WEB',
            alias: `e2e-cred-did-${RUN_ID}`,
            name: `E2E Credential DID ${RUN_ID}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(201);
          tenantDidValue = response.body.did;
        });
      }

      // Seed a DID belonging to a different tenant
      cy.task('seedForeignTenantDid').then((result: any) => {
        foreignDid = result.did;
      });
    });

    after(() => {
      if (config.capabilities.dbAccess) cy.task('cleanupForeignTenantDid');
    });

    it('issues a credential using the system default DID', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(defaultDidValue),
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
      });
    });

    // Signing with a tenant-created managed DID requires VCKit to resolve
    // the did:web document over HTTPS during signing.
    it('issues a credential using a tenant-owned DID', function () {
      if (!config.services.vckit.didWebResolvable) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(tenantDidValue),
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
        },
      })
        .then((response) => {
          expect(response.status).to.eq(201);
          const credentialId = response.body.credentialId;
          expect(credentialId).to.be.a('string');
          return cy.request(`/api/v1/library/${credentialId}`);
        })
        .then((libraryResponse) => {
          expect(libraryResponse.status).to.eq(200);
          return cy.request({
            method: 'POST',
            url: '/api/v1/credentials/verify',
            body: {
              uri: libraryResponse.body.storageUri,
              digestMultibase: libraryResponse.body.digestMultibase,
              decryptionKey: libraryResponse.body.decryptionKey,
            },
          });
        })
        .then((verifyResponse) => {
          expect(verifyResponse.status).to.eq(200);
          expect(verifyResponse.body.verified).to.be.true;
        });
    });

    it('rejects issuance with a DID belonging to another tenant', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(foreignDid),
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.contain('not registered to your tenant');
      });
    });

    it('rejects issuance with a fabricated DID that does not exist', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload('did:web:nonexistent.example.com'),
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.contain('not registered to your tenant');
      });
    });

    // The secondary service uses the same declared did:web capability.
    it('issues a credential using a DID on a non-primary VC service instance', function () {
      if (!config.services.vckit.didWebResolvable) this.skip();
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: `E2E VCKit VC Secondary ${RUN_ID}`,
          config: {
            baseUrl: config.services.vckit.baseUrl,
            apiKey: config.services.vckit.apiKey,
          },
          isPrimary: false,
        },
      })
        .then((res) => {
          expect(res.status).to.eq(201);
          const secondVcServiceId = res.body.id;

          return cy.request({
            method: 'POST',
            url: '/api/v1/dids',
            body: {
              type: 'MANAGED',
              method: 'DID_WEB',
              alias: `e2e-secondary-did-${RUN_ID}`,
              name: `E2E Secondary DID ${RUN_ID}`,
              serviceInstanceId: secondVcServiceId,
            },
          });
        })
        .then((didRes) => {
          expect(didRes.status).to.eq(201);
          const secondaryDid = didRes.body.did;

          cy.request({
            method: 'POST',
            url: '/api/v1/credentials',
            body: {
              credentialPayload: buildCredentialPayload(secondaryDid),
              credentialType: 'DigitalProductPassport',
              version: '0.6.1',
            },
          }).then((response) => {
            expect(response.status).to.eq(201);
            expect(response.body.credentialId).to.be.a('string');
          });
        });
    });
  });

  // -----------------------------------------------------------------------
  // Issue and retrieve
  // -----------------------------------------------------------------------
  describe('Issue and retrieve credentials', () => {
    it('POST /api/v1/credentials: issues an encrypted credential', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(defaultDidValue),
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
        encryptedCredentialId = response.body.credentialId;
      });
    });

    it('GET /api/v1/library/:id: retrieves the encrypted credential', () => {
      cy.request(`/api/v1/library/${encryptedCredentialId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.headers['cache-control']).to.contain('no-store');
        const cred = response.body;
        expect(cred.id).to.eq(encryptedCredentialId);
        expect(cred.storageUri).to.be.a('string');
        expect(cred.digestMultibase).to.be.a('string');
        expect(cred.credential.credentialType).to.eq('DPP');
        expect(cred.decryptionKey).to.be.a('string');
      });
    });
  });

  describe('Issuance idempotency', () => {
    it('replays an identical request and rejects a changed body for the same key', () => {
      const idempotencyKey = `e2e-credential-issue-${RUN_ID}`;
      const issueBody = {
        credentialPayload: buildCredentialPayload(defaultDidValue),
        credentialType: 'DigitalProductPassport',
        version: '0.6.1',
      };
      const changedBody = {
        ...issueBody,
        credentialPayload: {
          ...issueBody.credentialPayload,
          credentialSubject: {
            ...issueBody.credentialPayload.credentialSubject,
            id: `https://example.com/products/idempotency-changed-${RUN_ID}`,
          },
        },
      };

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: issueBody,
      })
        .then((firstResponse) => {
          expect(firstResponse.status).to.eq(201);
          expect(firstResponse.body.credentialId).to.be.a('string');
          return cy
            .request({
              method: 'POST',
              url: '/api/v1/credentials',
              headers: { 'Idempotency-Key': idempotencyKey },
              body: issueBody,
            })
            .then((replayResponse) => {
              expect(replayResponse.status).to.eq(201);
              expect(replayResponse.body.credentialId).to.eq(firstResponse.body.credentialId);
            });
        })
        .then(() =>
          cy.request({
            method: 'POST',
            url: '/api/v1/credentials',
            headers: { 'Idempotency-Key': idempotencyKey },
            body: changedBody,
            failOnStatusCode: false,
          }),
        )
        .then((response) => {
          expect(response.status).to.eq(422);
          expect(response.body.code).to.eq('IDEMPOTENCY_KEY_MISMATCH');
        });
    });
  });

  // -----------------------------------------------------------------------
  // Issuance options
  // -----------------------------------------------------------------------
  describe('Issuance options', () => {
    it('POST /api/v1/credentials: storageOptions.encrypt=false stores without encryption', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(defaultDidValue),
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          storageOptions: { encrypt: false },
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        unencryptedCredentialId = response.body.credentialId;
      });
    });

    it('GET /api/v1/library/:id: unencrypted credential has null decryptionKey', () => {
      cy.request(`/api/v1/library/${unencryptedCredentialId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.decryptionKey).to.be.null;
      });
    });

    it('POST /api/v1/credentials: publishingOptions.publish=true issues and publishes', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(defaultDidValue),
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          publishingOptions: { publish: true },
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
        publishedCredentialId = response.body.credentialId;
      });
    });

    it('GET /api/v1/library/:id: retrieves the published credential', () => {
      cy.request(`/api/v1/library/${publishedCredentialId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(publishedCredentialId);
      });
    });
  });

  // -----------------------------------------------------------------------
  // v0.6.0 credential issuance
  // -----------------------------------------------------------------------
  describe('v0.6.0 credential issuance', () => {
    it('POST /api/v1/credentials: issues a v0.6.0 DPP credential', () => {
      const payload = {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
        id: `urn:uuid:e2e-v060-dpp-${RUN_ID}`,
        type: ['DigitalProductPassport', 'VerifiableCredential'],
        issuer: {
          type: ['CredentialIssuer'],
          id: defaultDidValue,
          name: `E2E v0.6.0 DPP Issuer ${RUN_ID}`,
        },
        credentialSubject: {
          type: ['ProductPassport'],
          id: `https://example.com/products/e2e-v060-${RUN_ID}`,
        },
      };

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: payload,
          credentialType: 'DigitalProductPassport',
          version: '0.6.0',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
      });
    });

    it('POST /api/v1/credentials: issues a v0.6.0 DCC credential', () => {
      const uniqueSuffix = `${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;
      const payload = {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dcc/0.6.0/'],
        id: `urn:uuid:e2e-v060-dcc-${uniqueSuffix}`,
        type: ['DigitalConformityCredential', 'VerifiableCredential'],
        issuer: {
          type: ['CredentialIssuer'],
          id: defaultDidValue,
          name: `E2E v0.6.0 DCC Issuer ${RUN_ID}`,
        },
        credentialSubject: {
          type: ['ConformityAttestation', 'Attestation'],
          id: `https://example.com/e2e-v060/attestation/${uniqueSuffix}`,
          assessorLevel: 'Self',
          assessmentLevel: 'Unspecified',
          attestationType: 'certification',
          issuedToParty: {
            type: ['Party'],
            id: `https://example.com/e2e-v060/party/${uniqueSuffix}`,
            name: `E2E v0.6.0 Test Party ${RUN_ID}`,
          },
        },
      };

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: payload,
          credentialType: 'DigitalConformityCredential',
          version: '0.6.0',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
      });
    });

    it('returns 400 when requesting a nonexistent version', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(defaultDidValue),
          credentialType: 'DigitalProductPassport',
          version: '99.99.99',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Retired list route and issuance validation
  // -----------------------------------------------------------------------
  describe('Retired list route and issuance validation', () => {
    it('returns 410 when the retired list limit exceeds the former deployment maximum', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/credentials?limit=100000',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(410);
        expect(response.body).to.deep.eq({
          error: 'This route has been retired. Use GET /api/v1/library instead.',
          code: 'ROUTE_RETIRED',
        });
      });
    });

    it('returns 410 for a malformed strict-integer limit (1abc) on the retired list', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/credentials?limit=1abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(410);
        expect(response.body).to.deep.eq({
          error: 'This route has been retired. Use GET /api/v1/library instead.',
          code: 'ROUTE_RETIRED',
        });
      });
    });

    it('returns 400 for a mistyped storageOptions.encrypt', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: { type: ['DigitalProductPassport'] },
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          storageOptions: { encrypt: 'false' },
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.contain('storageOptions.encrypt');
      });
    });

    it('returns 400 with error body when credentialPayload is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {},
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string').and.not.be.empty;
      });
    });

    it('returns 400 when credentialPayload is null', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: null,
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when credentialPayload is a string', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: 'not-an-object',
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 when credentialPayload is a number', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: 42,
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for invalid JSON body', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: 'not valid json',
        headers: { 'Content-Type': 'application/json' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 when credentialType is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(defaultDidValue),
          version: '0.6.1',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 when version is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(defaultDidValue),
          credentialType: 'DigitalProductPassport',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Retired list route and library replacement
  // -----------------------------------------------------------------------
  describe('Retired list route and library replacement', () => {
    it('GET /api/v1/credentials: returns the retirement response after authentication', () => {
      cy.request({ method: 'GET', url: '/api/v1/credentials', failOnStatusCode: false }).then((response) => {
        expect(response.status).to.eq(410);
        expect(response.body).to.deep.eq({
          error: 'This route has been retired. Use GET /api/v1/library instead.',
          code: 'ROUTE_RETIRED',
        });
      });
    });

    it('GET /api/v1/library?origin=native: still finds an issued record', () => {
      cy.request('/api/v1/library?origin=native&sort=createdAt:desc').then((response) => {
        expect(response.status).to.eq(200);
        const record = response.body.data.find((row: any) => row.id === encryptedCredentialId);
        expect(record, 'issued record in native library results').to.exist;
        expect(record.origin).to.eq('native');
        expect(record.credential.credentialType).to.eq('DPP');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  describe('Delete an issued credential', () => {
    // The stored copy's URI as the RI returns it is reachable from the RI's
    // network; the browser reaches the same object through the host mapping.
    const hostReachable = (uri: string) => uri.replace('storage-service:3334', 'localhost:3334');
    let storedCopyUri: string;
    let externalSourceUri: string;

    it('DELETE /api/v1/credentials/:id: removes the record and its stored copy', () => {
      cy.request(`/api/v1/library/${encryptedCredentialId}`).then((detail) => {
        externalSourceUri = detail.body.storageUri;
      });
      cy.request(`/api/v1/library/${unencryptedCredentialId}`).then((detail) => {
        expect(detail.status).to.eq(200);
        storedCopyUri = hostReachable(detail.body.storageUri);
        cy.request({ url: storedCopyUri, failOnStatusCode: false }).its('status').should('eq', 200);
      });
      cy.request({ method: 'DELETE', url: `/api/v1/credentials/${unencryptedCredentialId}` }).then((response) => {
        expect(response.status).to.eq(204);
        expect(response.body).to.be.empty;
      });
      cy.request({ url: `/api/v1/library/${unencryptedCredentialId}`, failOnStatusCode: false })
        .its('status')
        .should('eq', 404);
      // Read the URI when this step runs, not when the chain is queued.
      cy.then(() => cy.request({ url: storedCopyUri, failOnStatusCode: false }).its('status').should('eq', 404));
    });

    it('DELETE /api/v1/credentials/:id: repeats as an empty 204', () => {
      cy.request({ method: 'DELETE', url: `/api/v1/credentials/${unencryptedCredentialId}` }).then((response) => {
        expect(response.status).to.eq(204);
        expect(response.body).to.be.empty;
      });
    });

    it('DELETE /api/v1/credentials/:id: refuses an external library record', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/library',
        headers: { 'Idempotency-Key': `e2e-credential-delete-refusal-${RUN_ID}` },
        body: {
          sourceUrl: externalSourceUri,
          annotations: { displayName: `E2E external for delete refusal ${RUN_ID}`, declaredCredentialType: 'DPP' },
        },
      }).then((registered) => {
        expect(registered.status).to.eq(201);
        expect(registered.body.origin).to.eq('external');
        cy.request({
          method: 'DELETE',
          url: `/api/v1/credentials/${registered.body.id}`,
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(403);
          expect(response.body.code).to.eq('EXTERNAL_RECORD_NOT_DELETABLE_HERE');
        });
        // The refusal left the external record in place. This suite's own
        // teardown removes it today; API teardown follows in the suite rewrite.
        cy.request(`/api/v1/library/${registered.body.id}`).its('body.origin').should('eq', 'external');
      });
    });
  });

  describe('Error handling', () => {
    it('GET /api/v1/credentials/:id: returns 410 for an issued credential id', () => {
      cy.request({
        method: 'GET',
        url: `/api/v1/credentials/${encryptedCredentialId}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(410);
        expect(response.body).to.deep.eq({
          error: 'This route has been retired. Use GET /api/v1/library/{id} instead.',
          code: 'ROUTE_RETIRED',
        });
      });
    });
  });
});
