import { config } from '../../../support/config';

describe('Credential Verify API', { testIsolation: false }, () => {
  const RUN_ID = Date.now();
  let testTenantId: string;
  let defaultDidValue: string;
  let unencryptedUri: string;
  let unencryptedDigest: string;
  let encryptedUri: string;
  let encryptedDigest: string;
  let encryptedKey: string;

  function buildCredentialPayload(issuerDid: string) {
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/'],
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
    // Clean up any stale data from a previous failed run
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });
    cy.task('cleanupTestUsers', { emails: [config.user.email, config.user2.email] });

    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: config.user.email }).then((result: any) => {
      testTenantId = result.tenantId;
    });

    // VC service instance
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'Verify E2E VCKit',
        config: {
          baseUrl: config.services.vckit.baseUrl,
          apiKey: config.services.vckit.apiKey,
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
          baseUrl: config.services.storage.baseUrl,
          apiKey: config.services.storage.apiKey,
          apiVersion: config.services.storage.apiVersion,
          publicBucket: config.services.storage.publicBucket,
          privateBucket: config.services.storage.privateBucket,
        },
        apiVersion: '3.1.0',
        isPrimary: true,
      },
    }).then((res) => expect(res.status).to.eq(201));

    // Look up system default DID
    cy.request('/api/v1/dids').then((response) => {
      const defaultDid = response.body.data.find((d: any) => d.isDefault === true);
      expect(defaultDid).to.exist;
      defaultDidValue = defaultDid.did;
    });
  });

  after(() => {
    const preserveTenant = config.tenantMode === 'closed';
    cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
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
          const cred = res.body;
          unencryptedUri = cred.storageUri;
          unencryptedDigest = cred.digestMultibase;
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
          const cred = res.body;
          encryptedUri = cred.storageUri;
          encryptedDigest = cred.digestMultibase;
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
        body: { uri: unencryptedUri, digestMultibase: unencryptedDigest },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.verified).to.be.true;
        expect(response.body.credential).to.exist;
        expect(response.body.credential.type).to.satisfy(
          (t: string | string[]) =>
            t === 'EnvelopedVerifiableCredential' || (Array.isArray(t) && t.includes('EnvelopedVerifiableCredential')),
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
          digestMultibase: encryptedDigest,
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

    it('returns 400 for invalid legacy hex hash format', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: unencryptedUri, hash: 'too-short' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for invalid digestMultibase format', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: unencryptedUri, digestMultibase: 'not-a-multibase-string' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });

    it('returns 400 for invalid decryptionKey format', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: unencryptedUri, decryptionKey: 'too-short' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
      });
    });

    it('returns 400 for invalid JSON body', () => {
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: 'not valid json',
        headers: { 'Content-Type': 'application/json' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.be.a('string');
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

    it('returns 422 when legacy hex hash does not match', () => {
      const wrongHash = 'f'.repeat(64);
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: unencryptedUri, hash: wrongHash },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(422);
        expect(response.body.code).to.eq('DIGEST_MISMATCH');
      });
    });

    it('returns 422 when digestMultibase does not match', () => {
      // A well-formed multibase-encoded sha2-256 multihash that doesn't match
      // the stored credential's content. `zQm` is the base58btc prefix for
      // sha2-256 multihashes; the trailing body is just non-matching bytes.
      const wrongDigest = 'zQm' + 'X'.repeat(43);
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: unencryptedUri, digestMultibase: wrongDigest },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(422);
        expect(response.body.code).to.eq('DIGEST_MISMATCH');
      });
    });

    it('returns error when storage URI is unreachable', () => {
      const ssrfEnabled = !Cypress.env('VERIFY_ALLOW_PRIVATE_URLS');
      cy.request({
        method: 'POST',
        url: '/api/v1/credentials/verify',
        body: { uri: 'https://nonexistent.invalid/credential' },
        failOnStatusCode: false,
      }).then((response) => {
        if (ssrfEnabled) {
          // SSRF validation rejects the URL before it reaches the upstream
          expect(response.status).to.eq(400);
        } else {
          expect(response.status).to.eq(502);
          expect(response.body.code).to.eq('UPSTREAM_ERROR');
        }
      });
    });
  });
});
