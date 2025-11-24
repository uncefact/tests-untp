describe('UNTP Playground Validation', () => {
  const credentialFiles = [
    'conformity-credential-simple.json',
    'identity-anchor-for-dcc-issuer.json',
    'identity-anchor-for-dia-issuer.json',
    'identity-anchor-for-dpp-issuer.json',
    'product-passport-simple.json',
  ];

  beforeEach(() => {
    cy.visit('http://localhost:4000'); // Assuming the app runs on port 4000
  });

  it('should upload credentials, run validation, and display tier1, tier2, and tier3 logs', () => {
    // Upload all credential files
    credentialFiles.forEach((fileName) => {
      const filePath = `../packages/untp-test-suite-mocha/example-credentials/UNTP/${fileName}`;
      cy.get('[data-testid="credential-upload-input"]').selectFile(filePath, { force: true });
      cy.contains(fileName); // Assert that the file name appears in the uploaded list
    });

    // Ensure untpTestSuite is loaded before running validation
    cy.window().its('untpTestSuite').should('exist', { timeout: 20000 });

    // Click "Run Validation"
    cy.contains('Run Validation').click();

    // Give some time for validation to run
    cy.wait(5000);

    // Assert that all tier1, tier2, and tier3 validation results appear in the log
    cy.get('#test-log', { timeout: 20000 }).should('be.visible');
    cy.get('#test-log', { timeout: 20000 }).should('contain', 'Tier 1 - W3C Verifiable Credential Validation');
    cy.get('#test-log', { timeout: 20000 }).should('contain', 'Tier 2 - UNTP Schema Validation');
    cy.get('#test-log', { timeout: 20000 }).should('contain', 'Tier 3 - UNTP RDF Validation');
  });
});
