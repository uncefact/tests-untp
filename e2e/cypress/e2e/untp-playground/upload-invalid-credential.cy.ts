describe('Display Error Messages', () => {
  beforeEach(() => {
    cy.visit('http://localhost:4000');
  });

  it('should show detail popup if upload file is not an object', () => {
    cy.uploadCredential([]);
    cy.contains('Fix validation error').click();
    cy.contains('Expected type: object').should('be.visible');
    cy.contains('Receive value:').should('be.visible');
    cy.contains('[]').should('be.visible');
    cy.contains('Issue:').should('be.visible');
  });

  it('should view detail of error when `UNTP Schema Validation` failed', () => {
    const invalidContextCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'DigitalProductPassport'],
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

    cy.uploadCredential(invalidContextCredential);
    cy.expandGroup();
    cy.checkValidationStatus('UNTP Schema Validation', 'failure');

    cy.openErrorDetailsByStepName('UNTP Schema Validation');
    cy.contains('Fix validation error').click();
    cy.contains('Issue:').should('be.visible');
  });

  it('should open error details when clicking on View Detail Upload', () => {
    cy.uploadCredential([]);
    cy.contains('Close').click();
    cy.contains('View Upload Detail').click();
    cy.contains('Fix validation error').click();
    cy.contains('Expected type: object').should('be.visible');
    cy.contains('Receive value:').should('be.visible');
    cy.contains('[]').should('be.visible');
    cy.contains('Issue:').should('be.visible');
  });

  it('should display error message when upload multiple files', () => {
    cy.uploadCredential([
      [],
      {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: {
          id: 'did:example:123',
          name: 'dev',
        },
        credentialSubject: {
          name: 'John Doe',
          id: 'did:example:123',
          type: ['Product'],
        },
      },
      {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/'],
        type: ['VerifiableCredential', 'DigitalProductPassport'],
        issuer: {
          id: 'did:example:123',
          name: 'dev',
        },
        credentialSubject: {
          name: 'John Doe',
          id: 'did:example:123',
          type: ['Product'],
        },
      },
    ]);

    cy.contains('Fix validation error').click();
    cy.contains('Close').click();
    cy.expandGroup();
    cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'success');
    cy.contains('View Upload Detail').click();
  });
});
