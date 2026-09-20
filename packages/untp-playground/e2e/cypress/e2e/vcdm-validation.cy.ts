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

    // Version detection now carries its own classified details, so the first View Details button
    // on the card is no longer the schema step's: open the schema step by name.
    cy.openErrorDetailsByStepName('VCDM Schema Validation');
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

    cy.get('[data-testid="credential-instance-header"]').then(($header) => {
      const headerBottom = $header[0].getBoundingClientRect().bottom;
      cy.get('button[aria-label^="Remove"]').then(($removeButton) => {
        expect($removeButton[0].getBoundingClientRect().bottom).to.be.at.most(headerBottom + 1);
      });
    });
    cy.get('[data-testid="vcdm-schema-validation-view-details"]').then(($viewDetails) => {
      const viewDetailsRect = $viewDetails[0].getBoundingClientRect();
      cy.wrap($viewDetails).click(viewDetailsRect.width / 2, viewDetailsRect.height / 2);
    });
    cy.contains('Fix validation error').click();
    cy.contains('Missing field: issuer').should('be.visible');
    cy.contains('Add the missing "issuer" field.').should('be.visible');
  });

  it('should classify schema fetch errors without blaming the credential', () => {
    cy.intercept('GET', '**/api/schema*', {
      statusCode: 500,
      body: 'Schema fetch failed',
    }).as('schemaFetch');

    cy.uploadCredential(validCredential);

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'success');

    cy.wait('@schemaFetch');
    cy.openErrorDetailsByStepName('VCDM Schema Validation');
    cy.get('[data-testid="validation-issue-card"]')
      .should('contain.text', 'could not fetch')
      .and('contain.text', 'Retry the check');
  });

  it('should show confetti for fully valid credential', () => {
    cy.uploadCredential('cypress/fixtures/credentials-e2e/valid-v2-enveloped-dpp.json');

    cy.expandGroup();
    cy.checkValidationStatus('VCDM Version Detection', 'success');
    cy.checkValidationStatus('VCDM Schema Validation', 'success');
    cy.validateConfetti();
  });
});
