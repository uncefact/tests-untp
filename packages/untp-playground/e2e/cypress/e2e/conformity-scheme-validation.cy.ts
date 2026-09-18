import { TestCaseStatus } from '../../../constants';
import { config } from '../support/config';
import { CONFORMITY_SCHEME_E2E_VERSIONS } from '../fixtures/conformity-schemes-e2e/registry';

/**
 * E2E matrix for ConformityScheme uploads.
 *
 * Iterates the version registry and, for each spec version, exercises:
 *   - the canonical valid sample (must reach SUCCESS on all four steps)
 *   - one test per malformed mutation, asserting failure surfaces on the
 *     pipeline step the registry declares.
 *
 * Extending coverage means appending to the registry. The step assertions here
 * must change when the pipeline adds a required step.
 */

const SCHEME_GROUP_HEADER = 'scheme-group-header';

// The tab declares intent (#676): a scheme upload must happen on the Conformity Schemes tab, and
// the results render in that tab's panel. Switch before uploading.
const openSchemesTab = () => cy.contains('[role="tab"]', 'Conformity Schemes').click();

CONFORMITY_SCHEME_E2E_VERSIONS.forEach((spec) => {
  describe(`ConformityScheme v${spec.version}`, () => {
    beforeEach(() => {
      cy.visit(config.playground.baseUrl);
    });

    it('valid sample reaches success on every pipeline step', () => {
      openSchemesTab();
      cy.uploadCredential(spec.validSample);
      cy.get(`[data-testid="${SCHEME_GROUP_HEADER}"]`).click();

      cy.checkValidationStatus('Version Detection', 'success');
      cy.checkValidationStatus('Schema Validation', 'success');
      cy.checkValidationStatus('Structural Parse', 'success');
      cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'success');
    });

    it('includes the Structural Parse failure in a generated report', () => {
      const structuralParseCase = spec.invalidCases.find((invalidCase) => invalidCase.failsAt === 'Structural Parse');
      expect(structuralParseCase, 'registry contains a Structural Parse case').to.exist;
      const malformed = structuralParseCase!.mutate(JSON.parse(JSON.stringify(spec.validSample)));
      const implementationName = `Structural Parse Report ${spec.version}`;

      openSchemesTab();
      cy.uploadCredential(malformed);
      cy.get(`[data-testid="${SCHEME_GROUP_HEADER}"]`).click();
      cy.checkValidationStatus('Structural Parse', 'failure');

      cy.generateReport(implementationName);
      cy.downloadAndVerifyReport(implementationName, false).then((report) => {
        const structuralParseStep = report.conformitySchemes[0].steps.find(
          (step: { name: string }) => step.name === 'Structural Parse',
        );
        expect(structuralParseStep).to.exist;
        expect(structuralParseStep.status).to.eq(TestCaseStatus.FAILURE);
      });
    });

    spec.invalidCases.forEach((invalidCase) => {
      it(`rejects: ${invalidCase.name} (fails at ${invalidCase.failsAt})`, () => {
        const malformed = invalidCase.mutate(JSON.parse(JSON.stringify(spec.validSample)));

        openSchemesTab();
        cy.uploadCredential(malformed);
        if (invalidCase.name === 'blank scheme name') {
          cy.get(`[data-testid="${SCHEME_GROUP_HEADER}"] h3`).should('have.text', 'credential.json');
        }
        cy.get(`[data-testid="${SCHEME_GROUP_HEADER}"]`).click();

        cy.checkValidationStatus(invalidCase.failsAt, 'failure');
        cy.openErrorDetailsByStepName(invalidCase.failsAt);
        if (invalidCase.name === 'blank scheme name') {
          cy.contains('/name: scheme.name is required and must be a non-empty string.').should('be.visible');
        }
      });
    });
  });
});
