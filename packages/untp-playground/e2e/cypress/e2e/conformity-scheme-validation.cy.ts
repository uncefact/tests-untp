import { config } from '../support/config';
import { CONFORMITY_SCHEME_E2E_VERSIONS } from '../fixtures/conformity-schemes-e2e/registry';

/**
 * E2E matrix for ConformityScheme uploads.
 *
 * Iterates the version registry and, for each spec version, exercises:
 *   - the canonical valid sample (must reach SUCCESS on all three steps)
 *   - one test per malformed mutation, asserting failure surfaces on the
 *     pipeline step the registry declares.
 *
 * Extending coverage means appending to the registry; this spec file does
 * not need to change.
 */

const SCHEME_GROUP_HEADER = 'ConformityScheme-group-header';

CONFORMITY_SCHEME_E2E_VERSIONS.forEach((spec) => {
  describe(`ConformityScheme v${spec.version}`, () => {
    beforeEach(() => {
      cy.visit(config.playground.baseUrl);
    });

    it('valid sample reaches success on every pipeline step', () => {
      cy.uploadCredential(spec.validSample);
      cy.get(`[data-testid="${SCHEME_GROUP_HEADER}"]`).click();

      cy.checkValidationStatus('Version Detection', 'success');
      cy.checkValidationStatus('Schema Validation', 'success');
      cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'success');
    });

    spec.invalidCases.forEach((invalidCase) => {
      it(`rejects: ${invalidCase.name} (fails at ${invalidCase.failsAt})`, () => {
        const malformed = invalidCase.mutate(JSON.parse(JSON.stringify(spec.validSample)));

        cy.uploadCredential(malformed);
        cy.get(`[data-testid="${SCHEME_GROUP_HEADER}"]`).click();

        cy.checkValidationStatus(invalidCase.failsAt, 'failure');
      });
    });
  });
});
