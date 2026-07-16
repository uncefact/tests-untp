import { VCDM_CONTEXT_URLS } from '../../../constants';
import { config } from '../support/config';

describe('VCDM Schema Validation', () => {
  beforeEach(() => {
    cy.visit(config.playground.baseUrl);
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

  // The coloured VCDM-version pill is gone (#810): VCDM v2 is the only supported version, and the
  // VCDM Version Detection checklist step already carries this signal, so every case below asserts
  // it directly instead of the removed pill text/colour.

  it('should validate a VCDM v2` credential successfully', () => {
    cy.uploadCredential(validCredential);

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'success');
    cy.checkValidationStatus('VCDM Schema Validation', 'success');
  });

  it('should show error for v1 VCDM version', () => {
    cy.uploadCredential(v1VcdmCredential);

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'success');
    cy.checkValidationStatus('VCDM Schema Validation', 'failure');
  });

  it('should show error for unsupported VCDM version', () => {
    cy.uploadCredential(invalidVcdmVersionCredential);

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'failure');
  });

  it('should show validation errors for missing @context', () => {
    cy.uploadCredential(missingContextCredential);

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'failure');
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

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'success');
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

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'success');

    cy.wait('@schemaFetch');
    cy.get('[data-sonner-toast]').contains('Failed to fetch the VCDM schema').should('exist');
  });

  it('should show confetti for fully valid credential', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/valid-v2-enveloped-dpp.json');

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'success');
    cy.checkValidationStatus('VCDM Schema Validation', 'success');
    cy.validateConfetti();
  });
});
