describe('Credential API', { testIsolation: false }, () => {
  const TEST_ORG_ID = 'e2e-test-org';
  const RUN_ID = Date.now();
  let defaultDidValue: string;
  let encryptedCredentialId: string;
  let unencryptedCredentialId: string;
  let publishedCredentialId: string;

  /**
   * Builds a minimal valid CredentialPayload conforming to the DPP v0.6.1 schema.
   */
  function buildCredentialPayload(issuerDid: string) {
    return {
      '@context': [
        'https://www.w3.org/ns/credentials/v2',
        'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/',
      ],
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
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // Create VC service instance (required for signing credentials)
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'E2E VCKit VC',
        config: {
          endpoint: 'http://vckit-api:3332/v2',
          apiKey: 'test123',
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
          baseUrl: 'http://storage-service:3334',
          apiKey: 'test123',
          apiVersion: '3.1.0',
        },
        apiVersion: '3.1.0',
        isPrimary: true,
      },
    }).then((res) => {
      expect(res.status).to.eq(201);
    });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: TEST_ORG_ID });
  });

  // -----------------------------------------------------------------------
  // Issue and retrieve
  // -----------------------------------------------------------------------
  describe('Issue and retrieve credentials', () => {
    it('looks up the system default DID to use as issuer', () => {
      cy.request('/api/v1/dids').then((response) => {
        expect(response.status).to.eq(200);
        const defaultDid = response.body.data.find(
          (d: any) => d.isDefault === true,
        );
        expect(defaultDid).to.exist;
        defaultDidValue = defaultDid.did;
      });
    });

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
      cy.request(`/api/v1/credentials/${encryptedCredentialId}`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.credential).to.exist;

          const cred = response.body.credential;
          expect(cred.id).to.eq(encryptedCredentialId);
          expect(cred.storageUri).to.be.a('string');
          expect(cred.hash).to.be.a('string');
          expect(cred.credentialType).to.eq('DigitalProductPassport');
          expect(cred.isPublished).to.be.false;
          // API defaults encrypt to true, so decryptionKey is present
          expect(cred.decryptionKey).to.be.a('string');
        },
      );
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
      cy.request(`/api/v1/credentials/${unencryptedCredentialId}`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.credential.decryptionKey).to.be.null;
        },
      );
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
      cy.request(`/api/v1/credentials/${publishedCredentialId}`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.credential).to.exist;
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // v0.6.0 credential issuance
  // -----------------------------------------------------------------------
  describe('v0.6.0 credential issuance', () => {
    it('POST /api/v1/credentials — issues a v0.6.0 DPP credential', () => {
      const payload = {
        '@context': [
          'https://www.w3.org/ns/credentials/v2',
          'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/',
        ],
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

    it('POST /api/v1/credentials — issues a v0.6.0 DCC credential with CVC validation', () => {
      const uniqueSuffix = `${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;
      const payload = {
        '@context': [
          'https://www.w3.org/ns/credentials/v2',
          'https://test.uncefact.org/vocabulary/untp/dcc/0.6.0/',
        ],
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
