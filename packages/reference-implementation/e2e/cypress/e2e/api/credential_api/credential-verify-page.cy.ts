import { config } from '../../../support/config';

describe('Verify Page', { testIsolation: false }, () => {
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
      id: `urn:uuid:verify-page-e2e-${RUN_ID}`,
      type: ['DigitalProductPassport', 'VerifiableCredential'],
      issuer: {
        type: ['CredentialIssuer'],
        id: issuerDid,
        name: `Verify Page E2E Issuer ${RUN_ID}`,
      },
      credentialSubject: {
        type: ['ProductPassport'],
        id: `https://example.com/products/verify-page-e2e-${RUN_ID}`,
      },
    };
  }

  function buildLegacyVerifyUrl(payload: Record<string, string>) {
    return `/verify?q=${encodeURIComponent(JSON.stringify({ payload }))}`;
  }

  function buildDirectVerifyUrl(params: Record<string, string>) {
    const searchParams = new URLSearchParams(params);
    return `/verify?${searchParams.toString()}`;
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
        name: 'Verify Page E2E VCKit',
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
        name: 'Verify Page E2E Storage',
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

  // ── Happy paths ──────────────────────────────────────────────────

  describe('Happy paths', () => {
    it('verifies unencrypted credential via direct params with digestMultibase', () => {
      cy.visit(buildDirectVerifyUrl({ uri: unencryptedUri, digestMultibase: unencryptedDigest }));

      // Wait for loading to finish
      cy.contains('Verifying the credential', { timeout: 30000 }).should('not.exist');
      cy.contains('Invalid verification link').should('not.exist');

      // Credential component renders with Rendered/JSON tabs
      cy.contains('JSON', { timeout: 30000 }).should('be.visible');
    });

    it('verifies unencrypted credential via legacy ?q= format with digestMultibase', () => {
      cy.visit(buildLegacyVerifyUrl({ uri: unencryptedUri, digestMultibase: unencryptedDigest }));

      cy.contains('Verifying the credential', { timeout: 30000 }).should('not.exist');
      cy.contains('Invalid verification link').should('not.exist');
      cy.contains('JSON', { timeout: 30000 }).should('be.visible');
    });

    it('verifies encrypted credential via direct params with digestMultibase', () => {
      cy.visit(
        buildDirectVerifyUrl({
          uri: encryptedUri,
          digestMultibase: encryptedDigest,
          decryptionKey: encryptedKey,
        }),
      );

      cy.contains('Verifying the credential', { timeout: 30000 }).should('not.exist');
      cy.contains('Invalid verification link').should('not.exist');
      cy.contains('JSON', { timeout: 30000 }).should('be.visible');
    });

    it('verifies encrypted credential via legacy ?q= format with digestMultibase', () => {
      cy.visit(
        buildLegacyVerifyUrl({
          uri: encryptedUri,
          digestMultibase: encryptedDigest,
          key: encryptedKey,
        }),
      );

      cy.contains('Verifying the credential', { timeout: 30000 }).should('not.exist');
      cy.contains('Invalid verification link').should('not.exist');
      cy.contains('JSON', { timeout: 30000 }).should('be.visible');
    });
  });

  // ── Error paths ──────────────────────────────────────────────────

  describe('Error paths', () => {
    it('shows error for invalid verification link (no params)', () => {
      cy.visit('/verify');
      cy.contains('Invalid verification link', { timeout: 10000 }).should('be.visible');
    });

    it('shows error for malformed JSON in ?q=', () => {
      cy.visit('/verify?q=not-json');
      cy.contains('Invalid verification link', { timeout: 10000 }).should('be.visible');
    });

    it('shows error for missing uri in legacy payload', () => {
      cy.visit(buildLegacyVerifyUrl({ hash: 'abc' }));
      cy.contains('Invalid verification link', { timeout: 10000 }).should('be.visible');
    });

    it('shows error when digestMultibase does not match', () => {
      // SHA-256 of the empty string, wrapped as multihash and encoded as
      // base58btc. Parseable as a multibase digest (so it passes the API's
      // validation step), but cannot match the credential's JSON content.
      const wrongDigest = 'zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n';
      cy.visit(buildDirectVerifyUrl({ uri: unencryptedUri, digestMultibase: wrongDigest }));

      // Should not show the "invalid link" message (the link itself is valid)
      cy.contains('Invalid verification link').should('not.exist');

      // The API returns 422 DIGEST_MISMATCH; the page displays its message
      cy.contains('digest does not match', { matchCase: false, timeout: 30000 }).should('be.visible');
    });

    it('shows error when legacy hex hash does not match', () => {
      const wrongHash = 'f'.repeat(64);
      cy.visit(buildDirectVerifyUrl({ uri: unencryptedUri, hash: wrongHash }));

      cy.contains('Invalid verification link').should('not.exist');
      cy.contains('digest does not match', { matchCase: false, timeout: 30000 }).should('be.visible');
    });

    it('shows error for unreachable URI', () => {
      const ssrfEnabled = !Cypress.env('VERIFY_ALLOW_PRIVATE_URLS');
      cy.visit(buildDirectVerifyUrl({ uri: 'https://nonexistent.invalid/credential' }));

      cy.contains('Invalid verification link').should('not.exist');

      if (ssrfEnabled) {
        // SSRF validation rejects the URL — page shows the rejection message
        cy.contains('DNS resolution failed', { matchCase: false, timeout: 30000 }).should('be.visible');
      } else {
        // The API returns 502 UPSTREAM_ERROR; the page displays its message
        cy.contains('Failed to fetch credential', { timeout: 30000 }).should('be.visible');
      }
    });
  });

  // ── Decryption key prompt ────────────────────────────────────────
  // A credential published to the Identity Resolver carries a keyless ?q=
  // link (the key travels out of band), so that link shape is the one the
  // prompt exists for.

  describe('Decryption key prompt', () => {
    it('prompts on a keyless ?q= link, then verifies with the entered key without touching the URL', () => {
      cy.visit(buildLegacyVerifyUrl({ uri: encryptedUri, digestMultibase: encryptedDigest }));

      cy.contains('Decryption key required', { timeout: 30000 }).should('be.visible');

      cy.get('#decryption-key').type(encryptedKey);
      cy.contains('button', 'Decrypt and verify').click();

      cy.contains('JSON', { timeout: 30000 }).should('be.visible');
      cy.location('search').should((search) => {
        expect(search).to.not.contain(encryptedKey);
      });
    });

    it('prompts on keyless direct params too', () => {
      cy.visit(buildDirectVerifyUrl({ uri: encryptedUri, digestMultibase: encryptedDigest }));
      cy.contains('Decryption key required', { timeout: 30000 }).should('be.visible');
    });

    it('rejects a malformed key inline and allows correction', () => {
      cy.visit(buildLegacyVerifyUrl({ uri: encryptedUri, digestMultibase: encryptedDigest }));
      cy.contains('Decryption key required', { timeout: 30000 }).should('be.visible');

      cy.get('#decryption-key').type('not-a-valid-key');
      cy.contains('button', 'Decrypt and verify').click();
      cy.contains('64-character hexadecimal').should('be.visible');
      cy.get('#decryption-key').should('have.value', 'not-a-valid-key');
    });

    it('discards a typed key on refresh and shows the prompt again', () => {
      cy.visit(buildLegacyVerifyUrl({ uri: encryptedUri, digestMultibase: encryptedDigest }));
      cy.contains('Decryption key required', { timeout: 30000 }).should('be.visible');

      cy.get('#decryption-key').type(encryptedKey);
      cy.get('#decryption-key').should('have.value', encryptedKey);
      cy.reload();

      cy.contains('Decryption key required', { timeout: 30000 }).should('be.visible');
      cy.get('#decryption-key').should('have.value', '');
    });

    it('keeps the form on a wrong key and verifies after re-entry', () => {
      cy.visit(buildLegacyVerifyUrl({ uri: encryptedUri, digestMultibase: encryptedDigest }));
      cy.contains('Decryption key required', { timeout: 30000 }).should('be.visible');

      cy.get('#decryption-key').type('f'.repeat(64));
      cy.contains('button', 'Decrypt and verify').click();
      cy.contains('does not match', { timeout: 30000 }).should('be.visible');

      cy.get('#decryption-key').clear().type(encryptedKey);
      cy.contains('button', 'Decrypt and verify').click();
      cy.contains('JSON', { timeout: 30000 }).should('be.visible');
    });
  });
});
