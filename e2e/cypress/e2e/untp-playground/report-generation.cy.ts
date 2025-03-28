import { TestCaseStatus } from '../../../../packages/untp-playground/constants';

describe('Report Generation', () => {
  beforeEach(() => {
    cy.visit('http://localhost:4000');
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
      const result = report.results[0];
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
      const result = report.results[0];

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

    cy.generateReport('Extension Test Implementation');
    cy.downloadAndVerifyReport('Extension Test Implementation', false).then((report) => {
      const result = report.results[0];

      expect(result.core).to.exist;
      expect(result.core.type).to.equal('DigitalProductPassport');
      expect(result.core.version).to.match(/^0\.6\.0/);

      expect(result.extension).to.exist;
      expect(result.extension.type).to.equal('DigitalLivestockPassport');
      expect(result.extension.version).to.match(/^0\.4\.2/);
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
      const result = report.results[0];

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
});
