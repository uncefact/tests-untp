import { allowedContextValue } from '../../../constants';
import { config } from '../support/config';

describe('JSON-LD Expansion and Validation', () => {
  beforeEach(() => {
    cy.visit(config.playground.baseUrl);
  });

  const validCredential = {
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
  };

  const invalidJsonldSyntaxCredential = {
    ...validCredential,
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/',
      {
        '': '',
      },
    ],
  };

  const unresolvableContextCredential = {
    ...validCredential,
    '@context': ['https://unresolvable-context.invalid'],
  };

  const invalidPropertiesCredential = {
    ...validCredential,
    credentialSubject: {
      ...validCredential.credentialSubject,
      invalid: 'invalid-value',
    },
  };

  it('should validate context expansion and validation successfully', () => {
    cy.uploadCredential(validCredential);
    cy.expandGroup();
    cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'success');
  });

  it('should show error for invalid JSON-LD syntax', () => {
    cy.uploadCredential(invalidJsonldSyntaxCredential);
    cy.expandGroup();
    cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'failure');

    cy.openErrorDetailsByStepName('JSON-LD Document Expansion and Context Validation');
    cy.get('[data-testid="validation-issue-card"]')
      .should('contain.text', 'Invalid JSON-LD syntax; invalid term definition.')
      .and('contain.text', 'Report these details to the Playground operator.');
  });

  it('should show error for unresolvable context', () => {
    cy.uploadCredential(unresolvableContextCredential);
    cy.expandGroup();
    cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'failure');

    cy.openErrorDetailsByStepName('JSON-LD Document Expansion and Context Validation');
    cy.get('[data-testid="validation-issue-card"]')
      .should('contain.text', 'https://unresolvable-context.invalid')
      .and(
        'contain.text',
        'Retry the check. If it keeps failing, report the URL and these details to the Playground operator.',
      );
  });

  it('should show error for invalid properties', () => {
    cy.uploadCredential(invalidPropertiesCredential);
    cy.expandGroup();
    cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'failure');

    cy.openErrorDetailsByStepName('JSON-LD Document Expansion and Context Validation');
    cy.get('[data-testid="validation-issue-card"]')
      .should('contain.text', 'Property "invalid" appears in the credential but isn\'t defined by any @context.')
      .and('contain.text', 'Add "invalid" to a @context, or remove it from the credential.');
  });
});
