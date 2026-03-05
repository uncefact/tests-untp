describe('Verify Page', { testIsolation: false }, () => {
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
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // VC service instance
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'Verify Page E2E VCKit',
        config: {
          endpoint: 'http://vckit-api:3332/v2',
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
        name: 'Verify Page E2E Storage',
        config: {
          baseUrl: 'http://storage-service:3334',
          apiKey: 'test123',
          apiVersion: '3.0.0',
        },
        apiVersion: '3.0.0',
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

  // ── Happy paths ──────────────────────────────────────────────────

  describe('Happy paths', () => {
    it('verifies unencrypted credential via direct params', () => {
      cy.visit(buildDirectVerifyUrl({ uri: unencryptedUri, hash: unencryptedHash }));

      // Wait for loading to finish
      cy.contains('Verifying the credential', { timeout: 30000 }).should('not.exist');
      cy.contains('Invalid verification link').should('not.exist');

      // Credential component renders with Rendered/JSON tabs
      cy.contains('JSON', { timeout: 30000 }).should('be.visible');
    });

    it('verifies unencrypted credential via legacy ?q= format', () => {
      cy.visit(buildLegacyVerifyUrl({ uri: unencryptedUri, hash: unencryptedHash }));

      cy.contains('Verifying the credential', { timeout: 30000 }).should('not.exist');
      cy.contains('Invalid verification link').should('not.exist');
      cy.contains('JSON', { timeout: 30000 }).should('be.visible');
    });

    it('verifies encrypted credential via direct params', () => {
      cy.visit(buildDirectVerifyUrl({
        uri: encryptedUri,
        hash: encryptedHash,
        decryptionKey: encryptedKey,
      }));

      cy.contains('Verifying the credential', { timeout: 30000 }).should('not.exist');
      cy.contains('Invalid verification link').should('not.exist');
      cy.contains('JSON', { timeout: 30000 }).should('be.visible');
    });

    it('verifies encrypted credential via legacy ?q= format', () => {
      cy.visit(buildLegacyVerifyUrl({
        uri: encryptedUri,
        hash: encryptedHash,
        key: encryptedKey,
      }));

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

    it('shows error when hash does not match', () => {
      const wrongHash = 'f'.repeat(64);
      cy.visit(buildDirectVerifyUrl({ uri: unencryptedUri, hash: wrongHash }));

      // Should not show the "invalid link" message (the link itself is valid)
      cy.contains('Invalid verification link').should('not.exist');

      // The API returns 422 HASH_MISMATCH; the page displays the thrown error
      cy.contains('HASH_MISMATCH', { timeout: 30000 }).should('be.visible');
    });

    it('shows error for unreachable URI', () => {
      cy.visit(buildDirectVerifyUrl({ uri: 'https://nonexistent.invalid/credential' }));

      cy.contains('Invalid verification link').should('not.exist');

      // The page should display a network/upstream error message
      cy.get('body', { timeout: 30000 }).then(($body) => {
        // Ensure loading is finished and an error is shown (not the credential tabs)
        expect($body.text()).to.not.contain('Verifying the credential');
        expect($body.text()).to.not.contain('JSON');
      });
    });

    it('shows error when encrypted credential has no decryptionKey', () => {
      cy.visit(buildDirectVerifyUrl({ uri: encryptedUri }));

      cy.contains('Invalid verification link').should('not.exist');

      // The API returns 422 DECRYPTION_REQUIRED; the page displays the thrown error
      cy.contains('DECRYPTION_REQUIRED', { timeout: 30000 }).should('be.visible');
    });
  });
});
