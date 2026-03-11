describe('Credential Verify API', { testIsolation: false }, () => {
  const TEST_ORG_ID = 'e2e-test-org';
  const RUN_ID = Date.now();
  let defaultDidValue: string;
  let unencryptedUri: string;
  let unencryptedHash: string;
  let encryptedUri: string;
  let encryptedHash: string;
  let encryptedKey: string;

  function buildCredentialPayload(issuerDid: string) {
    return {
      '@context': [
        'https://www.w3.org/ns/credentials/v2',
        'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/',
      ],
      id: `urn:uuid:verify-e2e-${RUN_ID}`,
      type: ['DigitalProductPassport', 'VerifiableCredential'],
      issuer: {
        type: ['CredentialIssuer'],
        id: issuerDid,
        name: `Verify E2E Issuer ${RUN_ID}`,
      },
      credentialSubject: {
        type: ['ProductPassport'],
        id: `https://example.com/products/verify-e2e-${RUN_ID}`,
      },
    };
  }

  // ── Setup ──────────────────────────────────────────────────────────

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // VC service instance
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'Verify E2E VCKit',
        config: {
          baseUrl: 'http://vckit-api:3332',
          apiKey: 'test123',
        },
        apiVersion: '1.0.0',
        isPrimary: true,
      },
    }).then((res) => expect(res.status).to.eq(201));

    // Storage service instance
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'STORAGE',
        adapterType: 'UNCEFACT_STORAGE',
        name: 'Verify E2E Storage',
        config: {
          baseUrl: 'http://storage-service:3334',
          apiKey: 'test123',
          apiVersion: '3.1.0',
          publicBucket: 'verifiable-credentials',
          privateBucket: 'verifiable-credentials',
        },
        apiVersion: '3.1.0',
        isPrimary: true,
      },
    }).then((res) => expect(res.status).to.eq(201));

    // Look up system default DID
    cy.request('/api/v1/dids').then((response) => {
      const defaultDid = response.body.data.find(
        (d: any) => d.isDefault === true,
      );
      expect(defaultDid).to.exist;
      defaultDidValue = defaultDid.did;
    });
  });

  after(() => {
    cy.task('cleanupTestData', { tenantId: TEST_ORG_ID });
  });

  // ── Issue credentials for verification ─────────────────────────────

  describe('Setup: issue credentials', () => {
    it('issues an unencrypted credential', () => {
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
        const credId = response.body.credentialId;

        cy.request(`/api/v1/credentials/${credId}`).then((res) => {
          const cred = res.body.credential;
          unencryptedUri = cred.storageUri;
          unencryptedHash = cred.hash;
        });
      });
    });

    it('issues an encrypted credential', () => {
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
        const credId = response.body.credentialId;

        cy.request(`/api/v1/credentials/${credId}`).then((res) => {
          const cred = res.body.credential;
          encryptedUri = cred.storageUri;
          encryptedHash = cred.hash;
          encryptedKey = cred.decryptionKey;
        });
      });
    });
  });

  // ── Verification: happy paths ──────────────────────────────────────

  describe('POST /api/v1/credentials/verify', () => {
    it('verifies an unencrypted credential', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: unencryptedUri, hash: unencryptedHash },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.verified).to.be.true;
        expect(response.body.credential).to.exist;
        expect(response.body.credential.type).to.satisfy(
          (t: string | string[]) =>
            t === 'EnvelopedVerifiableCredential' ||
            (Array.isArray(t) && t.includes('EnvelopedVerifiableCredential')),
        );
        expect(response.body.decodedCredential).to.exist;
      });
    });

    it('verifies an encrypted credential with decryptionKey', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: {
          uri: encryptedUri,
          hash: encryptedHash,
          decryptionKey: encryptedKey,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.verified).to.be.true;
        expect(response.body.credential).to.exist;
        expect(response.body.decodedCredential).to.exist;
      });
    });

    it('does not require authentication', () => {
      // Make request without session cookies
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: unencryptedUri },
        headers: { cookie: '' },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.verified).to.be.a('boolean');
      });
    });
  });

  // ── Validation errors ──────────────────────────────────────────────

  describe('Validation errors', () => {
    it('returns 400 when uri is missing', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: {},
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 for invalid URI format', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: 'not-a-url' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for non-HTTP scheme', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: 'ftp://example.com/file' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for invalid hash format', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: unencryptedUri, hash: 'too-short' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });

  // ── Processing errors ──────────────────────────────────────────────

  describe('Processing errors', () => {
    it('returns 422 when encrypted credential has no decryptionKey', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: encryptedUri },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(422);
        expect(response.body.code).to.eq('DECRYPTION_REQUIRED');
      });
    });

    it('returns 422 when hash does not match', () => {
      const wrongHash = 'f'.repeat(64);
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: unencryptedUri, hash: wrongHash },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(422);
        expect(response.body.code).to.eq('HASH_MISMATCH');
      });
    });

    it('returns 502 when storage URI is unreachable', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: 'https://nonexistent.invalid/credential' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(502);
        expect(response.body.code).to.eq('UPSTREAM_ERROR');
      });
    });
  });
});
