import { VCDM_CONTEXT_URLS } from '../../../../packages/untp-playground/constants';

describe('VCDM Schema Validation', () => {
  // TODO: Use endpoint defined in e2e config
  beforeEach(() => {
    cy.visit('http://localhost:4000');
  });

  const validCredential = {
    '@context': [VCDM_CONTEXT_URLS.v2],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    issuer: 'did:example:123',
    validFrom: '2024-01-01T00:00:00Z',
    credentialSubject: {
      id: 'did:example:123',
      name: 'John Doe',
      email: 'john.doe@example.com',
    },
  };

  const v1VcdmCredential = {
    '@context': [VCDM_CONTEXT_URLS.v1],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    issuer: 'did:example:123',
  };

  const invalidVcdmVersionCredential = {
    '@context': ['https://example.com/vcdm-context.json'],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    issuer: 'did:example:123',
  };

  const missingContextCredential = {
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    issuer: 'did:example:123',
  };

  it('should validate a VCDM v2` credential successfully', () => {
    cy.uploadCredential(validCredential);

    cy.contains('VCDM v2').should('be.visible');
    cy.checkVCDMVersionColor('DigitalProductPassport', 'green');

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'success');
    cy.checkValidationStatus('VCDM Schema Validation', 'success');
  });

  it('should show error for v1 VCDM version', () => {
    cy.uploadCredential(v1VcdmCredential);

    cy.contains('VCDM v1').should('be.visible');
    cy.checkVCDMVersionColor('DigitalProductPassport', 'red');

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'success');
    cy.checkValidationStatus('VCDM Schema Validation', 'failure');
  });

  it('should show error for unsupported VCDM version', () => {
    cy.uploadCredential(invalidVcdmVersionCredential);

    cy.contains('Unsupported VCDM version').should('be.visible');
    cy.checkVCDMVersionColor('DigitalProductPassport', 'red');

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'failure');
  });

  it('should show validation errors for missing @context', () => {
    cy.uploadCredential(missingContextCredential);

    cy.contains('Unsupported VCDM version').should('be.visible');
    cy.checkVCDMVersionColor('DigitalProductPassport', 'red');

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Schema Validation', 'failure');

    cy.openErrorDetails();
    cy.contains('Fix validation error').click();
    cy.contains('Missing field: @context').should('be.visible');
    cy.contains('Add the missing "@context" field.').should('be.visible');
  });

  it('should show schema validation errors in error dialog', () => {
    const invalidCredential = {
      '@context': [VCDM_CONTEXT_URLS.v2],
      type: ['VerifiableCredential', 'DigitalProductPassport'],
    };

    cy.uploadCredential(invalidCredential);

    cy.contains('VCDM v2').should('be.visible');
    cy.checkVCDMVersionColor('DigitalProductPassport', 'green');

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Schema Validation', 'failure');

    cy.openErrorDetails();
    cy.contains('Fix validation error').click();
    cy.contains('Missing field: issuer').should('be.visible');
    cy.contains('Add the missing "issuer" field.').should('be.visible');
  });

  it('should handle schema fetch errors gracefully', () => {
    cy.intercept('GET', '**/api/schema*', {
      statusCode: 500,
      body: 'Schema fetch failed',
    }).as('schemaFetch');

    cy.uploadCredential(validCredential);

    cy.contains('VCDM v2').should('be.visible');
    cy.checkVCDMVersionColor('DigitalProductPassport', 'green');

    cy.wait('@schemaFetch');
    cy.get('[data-sonner-toast]').contains('Failed to fetch the VCDM schema').should('exist');
  });

  it('should show confetti for fully valid credential', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/valid-v2-enveloped-dpp.json');

    cy.contains('VCDM v2').should('be.visible');
    cy.checkVCDMVersionColor('DigitalProductPassport', 'green');

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Schema Validation', 'success');
    cy.validateConfetti();
  });
});
