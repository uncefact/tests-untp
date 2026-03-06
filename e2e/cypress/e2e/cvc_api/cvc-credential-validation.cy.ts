/**
 * Tests CVC validation during DCC credential issuance.
 *
 * Seeds CVC catalogue data, then issues DCC credentials and verifies
 * that advisory CVC warnings are returned when criteria are missing
 * or unrecognised.
 */
describe('CVC Credential Validation', { testIsolation: false }, () => {
  const TEST_ORG_ID = 'e2e-test-org';
  const RUN_ID = Date.now();

  // Canonical IDs matching the seeded CVC fixture
  const PROFILE_CANONICAL_ID = 'https://example.com/e2e-cvc/scheme-1/profile-1';
  const CRITERION_1_CANONICAL_ID = 'https://example.com/e2e-cvc/criterion-1';
  const CRITERION_2_CANONICAL_ID = 'https://example.com/e2e-cvc/criterion-2';

  let defaultDidValue: string;

  /**
   * Builds a schema-valid DCC v0.6.1 credential payload.
   *
   * All required fields from the JSON Schema at
   * https://test.uncefact.org/vocabulary/untp/dcc/untp-dcc-schema-0.6.1.json
   * are populated with reasonable defaults.
   *
   * The scope.id references the seeded profile, and assessmentCriteria
   * can be customised per test via opts.scopeId and opts.criteriaIds.
   */
  function buildDccPayload(
    issuerDid: string,
    opts: { scopeId?: string; criteriaIds?: string[] } = {},
  ) {
    const { scopeId, criteriaIds = [] } = opts;
    const uniqueSuffix = `${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      '@context': [
        'https://www.w3.org/ns/credentials/v2',
        'https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/',
      ],
      id: `urn:uuid:e2e-cvc-${uniqueSuffix}`,
      type: ['DigitalConformityCredential', 'VerifiableCredential'],
      issuer: {
        type: ['CredentialIssuer'],
        id: issuerDid,
        name: `E2E CVC Test Issuer ${RUN_ID}`,
      },
      credentialSubject: {
        type: ['ConformityAttestation', 'Attestation'],
        id: `https://example.com/e2e-cvc/attestation/${uniqueSuffix}`,
        assessorLevel: 'Self',
        assessmentLevel: 'Unspecified',
        attestationType: 'certification',
        issuedToParty: {
          type: ['Party'],
          id: `https://example.com/e2e-cvc/party/${uniqueSuffix}`,
          name: `E2E Test Party ${RUN_ID}`,
        },
        ...(scopeId
          ? {
              scope: {
                type: ['ConformityScheme'],
                id: scopeId,
                name: 'E2E Test Conformity Scheme',
                description: 'A conformity scheme used for E2E CVC validation tests.',
                version: '1.0.0',
                validFrom: '2025-01-01',
                owner: {
                  type: ['Party'],
                  id: 'https://example.com/e2e-cvc/scheme-owner',
                  name: 'E2E Scheme Owner',
                },
              },
            }
          : {}),
        assessment:
          criteriaIds.length > 0
            ? [
                {
                  type: ['ConformityAssessment', 'Declaration'],
                  id: `https://example.com/e2e-cvc/assessment/${uniqueSuffix}`,
                  conformance: true,
                  conformityTopic: 'governance.compliance',
                  assessmentCriteria: criteriaIds.map((criterionId, index) => ({
                    type: ['Criterion'],
                    id: criterionId,
                    name: `E2E Criterion ${index + 1}`,
                    description: `Criterion ${index + 1} for E2E CVC validation tests.`,
                    conformityTopic: 'governance.compliance',
                    status: 'active',
                  })),
                },
              ]
            : [],
      },
    };
  }

  before(() => {
    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: 'e2e-admin@test.local' });

    // Seed CVC catalogue data
    cy.task('seedCvcCatalogue', { tenantId: TEST_ORG_ID });

    // Create VC service instance (required for signing)
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'E2E CVC VCKit',
        config: {
          endpoint: 'http://vckit-api:3332/v2',
          apiKey: 'test123',
        },
        apiVersion: '1.0.0',
        isPrimary: true,
      },
      failOnStatusCode: false,
    });

    // Create STORAGE service instance (required for storing credentials)
    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'STORAGE',
        adapterType: 'UNCEFACT_STORAGE',
        name: 'E2E CVC Storage',
        config: {
          baseUrl: 'http://storage-service:3334',
          apiKey: 'test123',
          apiVersion: '3.1.0',
        },
        apiVersion: '3.1.0',
        isPrimary: true,
      },
      failOnStatusCode: false,
    });

    // Look up the system default DID
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

  // -----------------------------------------------------------------------
  // Missing criteria warnings
  // -----------------------------------------------------------------------
  describe('Missing criteria warnings', () => {
    it('returns CVC_MISSING_CRITERION when credential omits criteria required by its profile', () => {
      const payload = buildDccPayload(defaultDidValue, {
        scopeId: PROFILE_CANONICAL_ID,
        criteriaIds: [CRITERION_1_CANONICAL_ID], // Only 1 of 2 criteria
      });

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: payload,
          credentialType: 'DigitalConformityCredential',
          version: '0.6.1',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
        expect(response.body.warnings).to.be.an('array');

        const missingWarnings = response.body.warnings.filter(
          (w: any) => w.code === 'CVC_MISSING_CRITERION',
        );
        expect(missingWarnings).to.have.length(1);
        expect(missingWarnings[0].detail).to.eq(CRITERION_2_CANONICAL_ID);
      });
    });

    it('returns no CVC warnings when all profile criteria are present', () => {
      const payload = buildDccPayload(defaultDidValue, {
        scopeId: PROFILE_CANONICAL_ID,
        criteriaIds: [CRITERION_1_CANONICAL_ID, CRITERION_2_CANONICAL_ID],
      });

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: payload,
          credentialType: 'DigitalConformityCredential',
          version: '0.6.1',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
        expect(response.body).not.to.have.property('warnings');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Unknown criteria warnings
  // -----------------------------------------------------------------------
  describe('Unknown criteria warnings', () => {
    it('returns CVC_UNKNOWN_CRITERION for criteria not in any imported catalogue', () => {
      const payload = buildDccPayload(defaultDidValue, {
        scopeId: PROFILE_CANONICAL_ID,
        criteriaIds: [
          CRITERION_1_CANONICAL_ID,
          CRITERION_2_CANONICAL_ID,
          'https://example.com/unknown-criterion',
        ],
      });

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: payload,
          credentialType: 'DigitalConformityCredential',
          version: '0.6.1',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.warnings).to.be.an('array');

        const unknownWarnings = response.body.warnings.filter(
          (w: any) => w.code === 'CVC_UNKNOWN_CRITERION',
        );
        expect(unknownWarnings).to.have.length(1);
        expect(unknownWarnings[0].detail).to.eq('https://example.com/unknown-criterion');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Scope warnings
  // -----------------------------------------------------------------------
  describe('Scope warnings', () => {
    it('returns CVC_SCOPE_NOT_FOUND when scope does not match any imported profile', () => {
      const payload = buildDccPayload(defaultDidValue, {
        scopeId: 'https://example.com/nonexistent-profile',
        criteriaIds: [CRITERION_1_CANONICAL_ID],
      });

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: payload,
          credentialType: 'DigitalConformityCredential',
          version: '0.6.1',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.warnings).to.be.an('array');

        const scopeWarnings = response.body.warnings.filter(
          (w: any) => w.code === 'CVC_SCOPE_NOT_FOUND',
        );
        expect(scopeWarnings).to.have.length(1);
      });
    });

    // CVC_NO_SCOPE cannot be tested E2E because a valid DCC always requires
    // scope with an id per the JSON Schema. The warning code is covered by
    // unit tests in cvc-validation.service.test.ts.

    it('returns CVC_NO_CRITERIA when credential has scope but no assessment criteria', () => {
      const payload = buildDccPayload(defaultDidValue, {
        scopeId: PROFILE_CANONICAL_ID,
        criteriaIds: [],
      });

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload: payload,
          credentialType: 'DigitalConformityCredential',
          version: '0.6.1',
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.warnings).to.be.an('array');

        const noCriteriaWarnings = response.body.warnings.filter(
          (w: any) => w.code === 'CVC_NO_CRITERIA',
        );
        expect(noCriteriaWarnings).to.have.length(1);
      });
    });
  });
});
