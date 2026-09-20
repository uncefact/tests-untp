import { config } from '../support/config';

describe('Display Error Messages', () => {
  beforeEach(() => {
    cy.visit(config.playground.baseUrl);
  });

  it('should show detail popup if upload file is not an object', () => {
    cy.uploadCredential([]);
    cy.contains('Fix validation error').click();
    cy.contains('Expected type: object').should('be.visible');
    cy.contains('Received value').should('be.visible');
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
    cy.contains('We Found 1 Issue').should('be.visible');
    cy.contains(
      'The credential declares @context entries ["https://www.w3.org/ns/credentials/v2"], but none carries a recognised UNTP version.',
    ).should('be.visible');
    cy.get('[data-testid="validation-issue-card"]').should(
      'contain.text',
      'The credential declares @context entries ["https://www.w3.org/ns/credentials/v2"], but none carries a recognised UNTP version.',
    );
    cy.contains('Check the credential @context for a recognised UNTP version.').should('be.visible');
  });

  it('should open error details when clicking on View Detail Upload', () => {
    cy.uploadCredential([]);
    cy.contains('Close').click();
    cy.contains('View Upload Detail').click();
    cy.contains('Fix validation error').click();
    cy.contains('Expected type: object').should('be.visible');
    cy.contains('Received value').should('be.visible');
    cy.contains('[]').should('be.visible');
    cy.contains('Issue:').should('be.visible');
  });

  it('handles multiple file uploads displaying errors or success for each', () => {
    cy.fixture('credentials-e2e/valid-v2-enveloped-dpp.json').then((credential) => {
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
        credential,
      ]);
    });

    cy.contains('Fix validation error').click();
    cy.contains('Close').click();
    cy.expandGroup();
    cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'success');
    cy.contains('View Upload Detail').click();
  });
});
