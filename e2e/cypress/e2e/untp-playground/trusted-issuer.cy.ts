describe('UNTP Playground Trusted Issuer Validation', () => {
    const credentialFiles = [
        'conformity-credential-simple.json',
        'identity-anchor-for-dcc-issuer.json',
        'identity-anchor-for-dia-issuer.json',
        'identity-anchor-for-dpp-issuer.json',
        'product-passport-simple.json',
    ];

    beforeEach(() => {
        cy.on('window:console', (msg) => {
            console.log('Browser Console:', msg);
        });
        cy.visit('http://localhost:4000');
    });

    it('should upload credentials, add trusted DID, and validate without specific error', () => {
        // Upload all credential files
        credentialFiles.forEach((fileName) => {
            const filePath = `../packages/untp-test-suite-mocha/example-credentials/UNTP/${fileName}`;
            cy.get('[data-testid="credential-upload-input"]').selectFile(filePath, { force: true });
            cy.contains(fileName);
        });

        // Add trusted issuer DID
        cy.window().then((win) => {
            cy.stub(win, 'prompt').returns('did:web:abr.business.gov.au');
        });
        cy.contains('Add Trusted Issuer DID').click();
        cy.contains('did:web:abr.business.gov.au'); // Verify it was added to the list

        // Ensure untpTestSuite is loaded
        cy.window().its('untpTestSuite').should('exist', { timeout: 20000 });

        // Click "Run Validation"
        cy.contains('Run Validation').click();

        // Wait for validation to complete
        cy.get('#test-log', { timeout: 30000 }).should('contain', 'All finished.');

        // Assert that the EYE reasoner error is NOT present (validates that EYE is working)
        cy.get('#test-log').should('not.contain', 'Error: EYE reasoner not available');

        // Assert that there are NO unattested issuer errors (validates that trusted DID is working)
        cy.get('#test-log').should('not.contain', 'all issuers should be attested');

        // Note: The test may show validation errors for criteria not being verified,
        // but that's expected based on the test credentials and is separate from
        // the trusted issuer functionality we're testing here.
    });
});
