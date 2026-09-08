import { TestCaseStatus } from '../../../constants';
import { config } from '../support/config';
import sampleDpp from '../../../public/samples/sample-digital-product-passport-v0.7.0.json';
import sampleLinkSet from '../../../public/samples/sample-link-set.json';

const openLinkSetsTab = () => cy.contains('[role="tab"]', 'Link Sets').click();
const LINKSET_CARD_HEADER = '[data-testid="linkset-card-header"]';
const DCC_HREF = 'https://credentials.example.org/conformity/dcc-batch-114.json';

describe('Report Generation', () => {
  beforeEach(() => {
    cy.visit(config.playground.baseUrl);
  });

  it('should disable report generation buttons initially', () => {
    cy.get('[data-testid="generate-report-button"]').should('be.disabled');
    cy.contains('button', 'Download Report').should('be.disabled');
  });

  it('should enable generate report button after successful validation', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/valid-v2-enveloped-dpp.json');
    cy.performSuccessfulValidation();
    cy.get('[data-testid="generate-report-button"]').should('be.enabled');
  });

  it('should allow report generation even if validation fails', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/invalid-schema-v2-enveloped-dpp.json');
    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'failure');
    cy.checkValidationStatus('VCDM Schema Validation', 'failure');
    cy.checkValidationStatus('UNTP Schema Validation', 'failure');

    cy.generateReport('Failed Implementation');
    cy.downloadAndVerifyReport('Failed Implementation', false).then((report) => {
      const result = report.verifiableCredentials[0];
      expect(result.status).to.equal(TestCaseStatus.FAILURE);
      expect(result.core.steps).to.be.an('array');
      expect(result.core.steps.some((step: any) => step.status === TestCaseStatus.FAILURE)).to.be.true;
    });
  });

  it('should disable generate button when implementation name is empty', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/valid-v2-enveloped-dpp.json');
    cy.performSuccessfulValidation();
    cy.get('[data-testid="generate-report-button"]').click();
    cy.get('[data-testid="confirm-generate-dialog-button"]').should('be.disabled');

    cy.get('[data-testid="implementation-name-input"]').type('Test').clear();
    cy.get('[data-testid="confirm-generate-dialog-button"]').should('be.disabled');
  });

  it('should disable generate report after generating one', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/valid-v2-enveloped-dpp.json');
    cy.performSuccessfulValidation();
    cy.generateReport('Test Implementation');
    cy.get('[data-testid="generate-report-button"]').should('be.disabled');
  });

  it('should generate report with correct core credential test results', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/valid-v2-enveloped-dpp.json');
    cy.performSuccessfulValidation();
    cy.generateReport('Core Test Implementation');
    cy.downloadAndVerifyReport('Core Test Implementation', true).then((report) => {
      const result = report.verifiableCredentials[0];

      expect(result.core).to.exist;
      expect(result.core.type).to.equal('DigitalProductPassport');
      expect(result.core.version).to.match(/^0\.6\.0-beta1/);
      expect(result.core.steps).to.be.an('array');

      const stepIds = result.core.steps.map((step: any) => step.id);
      expect(stepIds).to.include('proof-type');
      expect(stepIds).to.include('vcdm-version');
      expect(stepIds).to.include('vcdm-schema-validation');
      expect(stepIds).to.include('verification');
      expect(stepIds).to.include('untp-schema-validation');

      expect(
        result.core.steps.every(
          (step: any) => step.status === TestCaseStatus.SUCCESS || step.status === TestCaseStatus.WARNING,
        ),
      ).to.be.true;

      expect(result.extension).to.not.exist;
    });
  });

  it('should generate report with correct extension test results', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/invalid-v2-enveloped-dpp-with-extension.json');
    cy.expandGroup();

    cy.checkValidationStatus('Extension Schema Validation', 'failure');

    cy.generateReport('Extension Test Implementation');
    cy.downloadAndVerifyReport('Extension Test Implementation', false).then((report) => {
      const result = report.verifiableCredentials[0];

      expect(result.core).to.exist;
      expect(result.core.type).to.equal('DigitalProductPassport');
      expect(result.core.version).to.match(/^0\.5\.0/);

      expect(result.extension).to.exist;
      expect(result.extension.type).to.equal('DigitalLivestockPassport');
      expect(result.extension.version).to.match(/^0\.4\.0/);
      expect(result.extension.steps).to.be.an('array');

      const extensionStep = result.extension.steps.find((step: any) => step.id === 'extension-schema-validation');
      expect(extensionStep).to.exist;
      expect(extensionStep.status).to.equal(TestCaseStatus.FAILURE);
    });
  });

  it('should generate report with failed validation results', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/invalid-schema-v2-enveloped-dpp.json');
    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'failure');
    cy.checkValidationStatus('VCDM Schema Validation', 'failure');
    cy.checkValidationStatus('UNTP Schema Validation', 'failure');

    cy.generateReport('Failed Validation Implementation');
    cy.downloadAndVerifyReport('Failed Validation Implementation', false).then((report) => {
      const result = report.verifiableCredentials[0];

      expect(result.core).to.exist;
      expect(result.core.steps).to.be.an('array');

      const failedVcdmVersionStep = result.core.steps.find((step: any) => step.id === 'vcdm-version');
      expect(failedVcdmVersionStep).to.exist;
      expect(failedVcdmVersionStep.status).to.equal(TestCaseStatus.FAILURE);
      expect(failedVcdmVersionStep.details).to.exist;
      expect(failedVcdmVersionStep.details.version).to.equal('unknown');

      const failedVcdmSchemaValidationStep = result.core.steps.find(
        (step: any) => step.id === 'vcdm-schema-validation',
      );
      expect(failedVcdmSchemaValidationStep).to.exist;
      expect(failedVcdmSchemaValidationStep.status).to.equal(TestCaseStatus.FAILURE);
      expect(failedVcdmSchemaValidationStep.details).to.exist;
      expect(failedVcdmSchemaValidationStep.details.errors).to.be.an('array');
      expect(failedVcdmSchemaValidationStep.details.errors.length).to.be.greaterThan(0);

      const failedUntpSchemaValidationStep = result.core.steps.find(
        (step: any) => step.id === 'untp-schema-validation',
      );
      expect(failedUntpSchemaValidationStep).to.exist;
      expect(failedUntpSchemaValidationStep.status).to.equal(TestCaseStatus.FAILURE);
      expect(failedUntpSchemaValidationStep.details).to.exist;
      expect(failedUntpSchemaValidationStep.details.errors).to.be.an('array');
      expect(failedUntpSchemaValidationStep.details.errors.length).to.be.greaterThan(0);
    });
  });

  it('reports a link set on its own, with its version, both steps and pending coverage, without blocking generation (#814)', () => {
    openLinkSetsTab();
    cy.uploadCredential(sampleLinkSet);
    cy.get(LINKSET_CARD_HEADER).find('[data-testid$="status-icon-success"]', { timeout: 20000 }).should('exist');

    cy.generateReport('Link Set Implementation');
    cy.downloadAndVerifyReport('Link Set Implementation', true).then((report) => {
      expect(report.verifiableCredentials).to.deep.equal([]);
      expect(report.conformitySchemes).to.deep.equal([]);
      expect(report.linkSets).to.have.length(1);
      const entry = report.linkSets[0];
      // The bundled sample is validated against the version the selector defaulted to; the literal
      // locks the sample to that schema rather than restating the constant.
      expect(entry.validationVersion).to.equal('0.7.0');
      expect(entry.title).to.equal('credential.json'); // the upload command's fixed filename
      expect(entry.steps.map((step: any) => step.id)).to.deep.equal([
        'linkset-schema-validation',
        'linkset-link-type-coverage',
      ]);
      expect(entry.steps[0].status).to.equal(TestCaseStatus.SUCCESS);
      expect(entry.steps[0].details.kind).to.equal('document');
      expect(entry.steps[1].status).to.equal(TestCaseStatus.PENDING);
      expect(entry.steps[1].details.checked).to.equal(0);
      expect(entry.steps[1].details.total).to.equal(2);
    });
    cy.downloadAndVerifyReport('Link Set Implementation', true, 'html');
  });

  it('invalidates a generated report when a linked credential is verified, and the regenerated report records the mismatch (#814)', () => {
    cy.intercept('POST', '**/api/fetch', {
      statusCode: 200,
      body: { ok: true, body: JSON.stringify(sampleDpp), contentType: 'application/json', finalUrl: DCC_HREF },
    }).as('fetchLinked');

    openLinkSetsTab();
    cy.uploadCredential({
      linkset: [
        {
          anchor: 'https://resolver.example.org/01/09520123456788',
          'https://test.uncefact.org/voc/untp/dcc': [
            {
              href: DCC_HREF,
              type: 'application/vc+ld+json',
              title: 'Digital Conformity Credential',
              hreflang: ['en'],
            },
          ],
        },
      ],
    });
    cy.get(LINKSET_CARD_HEADER).find('[data-testid$="status-icon-success"]', { timeout: 20000 }).should('exist');

    cy.generateReport('Coverage Implementation');
    cy.downloadAndVerifyReport('Coverage Implementation', true).then((report) => {
      expect(report.linkSets[0].steps[1].status).to.equal(TestCaseStatus.PENDING);
    });

    cy.get(LINKSET_CARD_HEADER).click();
    cy.get('[data-testid="linked-credential-verify"]').click();
    cy.wait('@fetchLinked');
    cy.get('[data-testid="linkset-link-type-coverage-status-icon-failure"]', { timeout: 60000 }).should('exist');

    // The earlier report no longer describes what is on screen.
    cy.contains('button', 'Download Report').should('be.disabled');
    cy.get('[data-testid="generate-report-button"]').should('be.enabled');

    // A new implementation name gives the regenerated report its own download filename, so the
    // read below cannot pick up the first file.
    cy.generateReport('Coverage Implementation Regenerated');
    cy.downloadAndVerifyReport('Coverage Implementation Regenerated', false).then((report) => {
      const entry = report.linkSets[0];
      expect(entry.status).to.equal(TestCaseStatus.FAILURE);
      expect(entry.steps[1].status).to.equal(TestCaseStatus.FAILURE);
      expect(entry.steps[1].details.checked).to.equal(1);
      expect(entry.steps[1].details.mismatches).to.have.length(1);
      expect(entry.steps[1].details.mismatches[0]).to.include({ expectedType: 'dcc', href: DCC_HREF });
      expect(entry.steps[1].details.mismatches[0].detectedType).to.equal('DigitalProductPassport');
      // The verified credential is a real entry of the same report.
      expect(report.verifiableCredentials).to.have.length(1);
      expect(report.verifiableCredentials[0].core.type).to.equal('DigitalProductPassport');
      // The verified credential names the link set it came from (the upload command's filename).
      expect(report.verifiableCredentials[0].source).to.include({ via: 'link-set', linkSet: 'credential.json' });
    });
  });
});
