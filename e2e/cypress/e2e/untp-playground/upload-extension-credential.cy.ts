describe('Upload extension credential', () => {
  beforeEach(() => {
    cy.visit('http://localhost:4000');
  });

  const invalidContextCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0-beta5/'],
    type: ['DigitalLivestockPassport', 'DigitalProductPassport', 'VerifiableCredential'],
    issuer: {
      id: 'did:example:123',
      name: 'dev',
    },
    credentialSubject: {
      name: 'John Doe',
      id: 'did:example:123',
      type: ['Product'],
    },
  };

  const invalidTypeCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0-beta5/'],
    type: ['DigitalProductPassport', 'VerifiableCredential'],
    issuer: {
      id: 'did:example:123',
      name: 'dev',
    },
    credentialSubject: {
      name: 'John Doe',
      id: 'did:example:123',
      type: ['Product'],
    },
  };

  it('should validate extension credential successfully', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/valid-v2-enveloped-extension-dlp.json');
    cy.expandGroup();
    cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'success');
  });

  it('should show error for invalid context in extension credential', () => {
    cy.uploadCredential(invalidContextCredential);
    cy.contains('Fix validation error').click();
    cy.contains('"@context":').should('be.visible');
    cy.contains('"https://www.w3.org/ns/credentials/v2"').should('be.visible');

    cy.contains('"type":').should('be.visible');
    cy.contains('"VerifiableCredential"').should('be.visible');
    cy.contains('"DigitalProductPassport"').should('be.visible');
  });
});
