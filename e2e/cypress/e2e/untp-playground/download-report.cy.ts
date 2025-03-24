describe('Download Report', () => {
  beforeEach(() => {
    cy.visit('http://localhost:4000');
  });

  it('should disable download report buttons initially', () => {
    cy.contains('button', 'Download Report').should('be.disabled');
  });

  function validateAndDownloadReport(format: string) {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/valid-v2-enveloped-dpp.json');
    cy.performSuccessfulValidation();
    cy.generateReport('Core Test Implementation');
    cy.downloadAndVerifyReport('Core Test Implementation', true, format);
  }

  it('should generate and download the report in HTML format after successful validation', () => {
    validateAndDownloadReport('html');
  });

  it('should generate and download the report in JSON format after successful validation', () => {
    validateAndDownloadReport('json');
  });
});
