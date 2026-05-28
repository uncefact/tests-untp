/**
 * UNTP v0.7.0 issue + verify matrix.
 *
 * For each UNTP credential type at v0.7.0:
 *   1. Issues a credential via the RI's `POST /api/v1/credentials` endpoint,
 *      using the canonical v0.7.0 example payload (the same example data the
 *      render templates ship with) so the body satisfies the full v0.7.0
 *      schema. Only the issuer DID, credential id, and validity window are
 *      overridden so the credential is owned by the test tenant's default DID
 *      and is currently valid.
 *   2. Fetches the stored enveloped VC URI via `GET /api/v1/credentials/:id`.
 *   3. Fetches the enveloped VC body from the storage service (Docker
 *      internal host rewritten to the Cypress-reachable host).
 *   4. Cross-origin to the Playground, uploads the enveloped VC, and
 *      asserts the Playground groups it under the expected credential type
 *      and surfaces no validation failures.
 *
 * The matrix is the single source of truth for which credential types are
 * exercised. Adding a new credential type or a new spec version is a
 * one-row change to MATRIX.
 *
 * TODO(retrofit): extend the matrix to v0.6.0 and v0.6.1 once the v0.7.0
 * cross-service path is stable, so the verify-via-Playground assurance
 * applies to every supported UNTP version rather than only the newest.
 */

import { config } from '../../../support/config';

const PLAYGROUND_BASE_URL = Cypress.env('PLAYGROUND_BASE_URL') || 'http://localhost:4000';

// In Docker CI the RI returns storage URIs against the internal hostname
// (`storage-service:3334`). Cypress runs on the host and reaches the same
// service via the published port, so we rewrite the host portion before
// fetching. When the URI is already host-reachable (local dev), the
// substitution is a no-op.
function hostReachableStorageUri(uri: string): string {
  return uri.replace('storage-service:3334', 'localhost:3334');
}

interface MatrixEntry {
  /** RI credential type discriminator, used in the issue body. */
  credentialType: string;
  /**
   * Template directory under `src/templates/v0.7.0/` whose `example-data.json`
   * is the canonical, schema-valid v0.7.0 payload for this credential type.
   */
  templateDir: string;
}

const MATRIX: MatrixEntry[] = [
  { credentialType: 'DigitalProductPassport', templateDir: 'digital_product_passport' },
  { credentialType: 'DigitalConformityCredential', templateDir: 'digital_conformity_credential' },
  { credentialType: 'DigitalFacilityRecord', templateDir: 'digital_facility_record' },
  { credentialType: 'DigitalIdentityAnchor', templateDir: 'digital_identity_anchor' },
  { credentialType: 'DigitalTraceabilityEvent', templateDir: 'digital_traceability_event' },
];

describe('UNTP v0.7.0 issue and verify matrix', { testIsolation: false }, () => {
  const RUN_ID = String(Date.now());
  const VALID_FROM = new Date().toISOString();
  const VALID_UNTIL = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
  let testTenantId: string;
  let defaultDidValue: string;

  before(() => {
    cy.task('cleanupTestData', { tenantId: config.testOrg.id });
    cy.task('cleanupTestUsers', { emails: [config.user.email] });

    cy.apiLogin();
    cy.task('seedTestOrg', { userEmail: config.user.email }).then((result) => {
      testTenantId = (result as { tenantId: string }).tenantId;
    });

    cy.request({ method: 'GET', url: '/api/v1/dids' }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.data).to.be.an('array');
      const defaultDid = (response.body.data as Array<{ did: string; isDefault: boolean }>).find(
        (d) => d.isDefault === true,
      );
      expect(defaultDid, 'A default DID must be configured for the tenant').to.exist;
      defaultDidValue = defaultDid!.did;
    });
  });

  after(() => {
    const preserveTenant = config.tenantMode === 'closed';
    if (testTenantId) {
      cy.task('cleanupTestData', { tenantId: testTenantId, preserveTenant });
    }
  });

  MATRIX.forEach((entry) => {
    it(`issues a v0.7.0 ${entry.credentialType} via the RI and verifies it via the Playground`, () => {
      // The canonical example payloads live alongside the render templates.
      // Resolved relative to the Cypress project root (packages/.../e2e).
      cy.readFile(`../src/templates/v0.7.0/${entry.templateDir}/example-data.json`).then((credentialPayload) => {
        // The template is the issued credential. Override only the fields the
        // test owns: a unique id, the tenant's default issuer DID, and a
        // current validity window. `cy.readFile` re-parses per test, so
        // mutating it in place is safe.
        credentialPayload.id = `urn:uuid:e2e-v070-${entry.credentialType}-${RUN_ID}`;
        credentialPayload.issuer.id = defaultDidValue;
        credentialPayload.validFrom = VALID_FROM;
        credentialPayload.validUntil = VALID_UNTIL;

        cy.request({
          method: 'POST',
          url: '/api/v1/credentials',
          body: {
            credentialPayload,
            credentialType: entry.credentialType,
            version: '0.7.0',
          },
        }).then((issueResponse) => {
          expect(issueResponse.status).to.eq(201);
          expect(issueResponse.body.credentialId).to.be.a('string');
          const credentialId = issueResponse.body.credentialId as string;

          cy.request({ method: 'GET', url: `/api/v1/credentials/${credentialId}` }).then((getResponse) => {
            expect(getResponse.status).to.eq(200);
            expect(getResponse.body.storageUri).to.be.a('string');
            const storageUri = hostReachableStorageUri(getResponse.body.storageUri as string);

            cy.request({ method: 'GET', url: storageUri }).then((vcResponse) => {
              expect(vcResponse.status).to.eq(200);
              const envelopedVc = vcResponse.body;

              cy.origin(
                PLAYGROUND_BASE_URL,
                { args: { vc: envelopedVc, credentialType: entry.credentialType } },
                ({ vc, credentialType }) => {
                  cy.visit('/');
                  cy.get('[data-testid="credential-upload"]').should('be.visible');
                  cy.get('[data-testid="credential-upload-input"]').selectFile(
                    {
                      contents: Cypress.Buffer.from(JSON.stringify(vc)),
                      fileName: 'credential.json',
                      mimeType: 'application/json',
                    },
                    { force: true },
                  );

                  // The credential-type group renders an overall status icon
                  // (`StatusIcon` in `TestResults.tsx`, testId = credential
                  // type) that is `success` only when every validation step
                  // passes (proof type, VCDM version + schema, credential
                  // verification, UNTP schema, JSON-LD context). The
                  // verification step calls the configured VC service, so the
                  // timeout allows for that network round-trip. `should('exist')`
                  // retries until then.
                  cy.get(`[data-testid="${credentialType}-status-icon-success"]`, { timeout: 60000 }).should('exist');
                },
              );
            });
          });
        });
      });
    });
  });
});
