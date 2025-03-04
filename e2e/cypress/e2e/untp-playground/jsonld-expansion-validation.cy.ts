import { VCDM_CONTEXT_URLS, allowedContextValue } from '../../../../packages/untp-playground/constants';

describe('JSON-LD Expansion and Validation', () => {
  beforeEach(() => {
    cy.visit('http://localhost:4000');
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
    '@context': ['https://www.invalid.com'],
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
    cy.openValidationDetails('Use the correct value');

    cy.checkValidationErrorMessages([
      'Incorrect value: @context',
      'Invalid JSON-LD syntax; a term cannot be an empty string. Context: {"":""}',
      'Update the value(s) to the correct one(s) or remove the field(s).',
    ]);
  });

  it('should show error for unresolvable context', () => {
    cy.uploadCredential(unresolvableContextCredential);
    cy.expandGroup();
    cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'failure');

    cy.openErrorDetailsByStepName('JSON-LD Document Expansion and Context Validation');
    cy.openValidationDetails('Use the correct value');

    cy.checkValidationErrorMessages([
      'Incorrect value: @context',
      'Invalid URL: "https://www.invalid.com". Failed to resolve context url.',
      'Update the value(s) to the correct one(s) or remove the field(s).',
    ]);
  });

  it('should show error for invalid properties', () => {
    cy.uploadCredential(invalidPropertiesCredential);
    cy.expandGroup();
    cy.checkValidationStatus('JSON-LD Document Expansion and Context Validation', 'failure');

    cy.openErrorDetailsByStepName('JSON-LD Document Expansion and Context Validation');
    cy.openValidationDetails('Use the correct value');

    cy.checkValidationErrorMessages([
      'Incorrect value: credentialSubject/invalid',
      'Properties "credentialSubject/invalid" are defined in the credential but missing from the context.',
      'Update the value(s) to the correct one(s) or remove the field(s).',
    ]);
  });
});

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
    cy.contains('Example:').should('be.visible');
    cy.contains(JSON.stringify(allowedContextValue, null, 2)).should('be.visible');
  });

  it.only('should view detail of error when `UNTP Schema Validation` failed', () => {
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
    cy.contains('Unable to access the schema from the constructed URI at test.uncefact.org').should('be.visible');
    cy.contains('Example:').should('be.visible');
    cy.contains(JSON.stringify(allowedContextValue, null, 2)).should('be.visible');
  });
});
