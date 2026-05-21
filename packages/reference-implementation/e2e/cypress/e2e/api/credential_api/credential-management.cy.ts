import { config } from '../../../support/config';

describe('Credential API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
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

  before(() => {
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
        name: 'E2E VCKit VC',
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
        name: 'E2E Storage',
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
    const preserveTenant = config.tenantMode === 'closed';
    cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
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

      // Create a tenant-owned MANAGED DID (only when VCKit has an HTTPS
      // endpoint — did:web resolution requires HTTPS for signing)
      if (config.services.vckit.baseUrl.startsWith('https://')) {
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
      cy.task('cleanupForeignTenantDid');
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
    // the did:web document over HTTPS. In Docker CI the VCKit domain is an
    // internal hostname over HTTP, so did:web resolution fails. Skip when
    // VCKit is not on an HTTPS endpoint.
    it('issues a credential using a tenant-owned DID', function () {
      if (!config.services.vckit.baseUrl.startsWith('https://')) this.skip();

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: buildCredentialPayload(tenantDidValue),
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
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

    // Same did:web HTTPS constraint as the tenant-owned DID test above.
    it('issues a credential using a DID on a non-primary VC service instance', function () {
      if (!config.services.vckit.baseUrl.startsWith('https://')) this.skip();
      cy.request({
        method: 'POST',
        url: '/api/v1/services',
        body: {
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: 'E2E VCKit VC Secondary',
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
    it('POST /api/v1/credentials — issues an encrypted credential', () => {
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

    it('GET /api/v1/credentials/:id — retrieves the encrypted credential', () => {
      cy.request(`/api/v1/credentials/${encryptedCredentialId}`).then((response) => {
        expect(response.status).to.eq(200);
        const cred = response.body;
        expect(cred.id).to.eq(encryptedCredentialId);
        expect(cred.storageUri).to.be.a('string');
        expect(cred.digestMultibase).to.be.a('string');
        expect(cred.credentialType).to.eq('DigitalProductPassport');
        expect(cred.isPublished).to.be.false;
        // API defaults encrypt to true, so decryptionKey is present
        expect(cred.decryptionKey).to.be.a('string');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Issuance options
  // -----------------------------------------------------------------------
  describe('Issuance options', () => {
    it('POST /api/v1/credentials — storageOptions.encrypt=false stores without encryption', () => {
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

    it('GET /api/v1/credentials/:id — unencrypted credential has null decryptionKey', () => {
      cy.request(`/api/v1/credentials/${unencryptedCredentialId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.decryptionKey).to.be.null;
      });
    });

    it('POST /api/v1/credentials — publishingOptions.publish=true issues and publishes', () => {
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

    it('GET /api/v1/credentials/:id — retrieves the published credential', () => {
      cy.request(`/api/v1/credentials/${publishedCredentialId}`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(publishedCredentialId);
      });
    });
  });

  // -----------------------------------------------------------------------
  // v0.6.0 credential issuance
  // -----------------------------------------------------------------------
  describe('v0.6.0 credential issuance', () => {
    it('POST /api/v1/credentials — issues a v0.6.0 DPP credential', () => {
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

    it('POST /api/v1/credentials — issues a v0.6.0 DCC credential', () => {
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
  // Validation errors
  // -----------------------------------------------------------------------
  describe('Validation errors', () => {
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
  // List credentials
  // -----------------------------------------------------------------------
  describe('List credentials', () => {
    it('GET /api/v1/credentials — lists credentials with pagination metadata', () => {
      cy.request('/api/v1/credentials').then((response) => {
        expect(response.status).to.eq(200);

        // Paginated response shape
        expect(response.body.data).to.be.an('array');
        expect(response.body).to.not.have.property('ok');
        expect(response.body.pagination).to.exist;
        expect(response.body.pagination.total).to.be.a('number');
        expect(response.body.pagination.limit).to.eq(20);
        expect(response.body.pagination.offset).to.eq(0);
        expect(response.body.pagination.hasMore).to.be.a('boolean');

        // Should contain at least the credentials issued earlier in the suite
        expect(response.body.data.length).to.be.at.least(2);

        // Verify credential shape
        const cred = response.body.data[0];
        expect(cred.id).to.be.a('string');
        expect(cred.storageUri).to.be.a('string');
        expect(cred.digestMultibase).to.be.a('string');
        expect(cred.credentialType).to.be.a('string');
        expect(cred).to.have.property('isPublished');
        expect(cred).to.have.property('createdAt');
        expect(cred).to.have.property('updatedAt');
      });
    });

    it('GET /api/v1/credentials?credentialType=DigitalProductPassport — filters by type', () => {
      cy.request('/api/v1/credentials?credentialType=DigitalProductPassport').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.at.least(1);

        // All returned credentials should be DPP type
        response.body.data.forEach((cred: any) => {
          expect(cred.credentialType).to.eq('DigitalProductPassport');
        });
      });
    });

    it('GET /api/v1/credentials?isPublished=true — filters by published status', () => {
      cy.request('/api/v1/credentials?isPublished=true').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');

        // All returned credentials should be published
        response.body.data.forEach((cred: any) => {
          expect(cred.isPublished).to.be.true;
        });
      });
    });

    it('GET /api/v1/credentials?isPublished=false — filters by unpublished', () => {
      cy.request('/api/v1/credentials?isPublished=false').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array');

        response.body.data.forEach((cred: any) => {
          expect(cred.isPublished).to.be.false;
        });
      });
    });

    it('GET /api/v1/credentials?limit=1 — respects limit', () => {
      cy.request('/api/v1/credentials?limit=1').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.have.length(1);
        expect(response.body.pagination.limit).to.eq(1);
        expect(response.body.pagination.hasMore).to.be.true;
      });
    });

    it('GET /api/v1/credentials?limit=1&offset=1 — respects offset', () => {
      cy.request('/api/v1/credentials?limit=1&offset=1').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.have.length(1);
        expect(response.body.pagination.offset).to.eq(1);
      });
    });

    it('GET /api/v1/credentials?credentialType=NonExistent — returns empty for unknown type', () => {
      cy.request('/api/v1/credentials?credentialType=NonExistentType').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.data).to.be.an('array').and.have.length(0);
        expect(response.body.pagination.total).to.eq(0);
      });
    });

    it('GET /api/v1/credentials?isPublished=yes — returns 400 for invalid boolean', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/credentials?isPublished=yes',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('GET /api/v1/credentials?limit=0 — returns 400 for invalid limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/credentials?limit=0',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('GET /api/v1/credentials?offset=-1 — returns 400 for invalid offset', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/credentials?offset=-1',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('GET /api/v1/credentials?limit=abc — returns 400 for non-numeric limit', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/credentials?limit=abc',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  describe('Error handling', () => {
    it('GET /api/v1/credentials/:id — returns 404 for nonexistent credential', () => {
      cy.request({
        method: 'GET',
        url: '/api/v1/credentials/nonexistent-id',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
  });
});
