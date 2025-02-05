declare global {
  namespace Cypress {
    interface Chainable<Subject = any> {
      /**
       * Uploads a credential file.
       * Accepts either an object (which will be stringified) or a path to a fixture file.
       */
      uploadCredential(credential: object | string): Chainable<Subject>;
      /**
       * Expands a validation group. Defaults to the DigitalProductPassport group.
       */
      expandGroup(groupTestId?: string): Chainable<Subject>;
      /**
       * Checks that the validation status icon for a given step is visible.
       * The status can be either 'success', 'failure', 'in progress', or 'missing'.
       */
      checkValidationStatus(
        stepName: string,
        status: 'success' | 'failure' | 'in progress' | 'missing',
      ): Chainable<Subject>;
      /**
       * Opens the error details draw.
       */
      openErrorDetails(): Chainable<Subject>;
      /**
       * Validates that the confetti is visible.
       */
      validateConfetti(): Chainable<Subject>;
    }
  }
}

// Command to upload a credential file (object data or fixture path)
Cypress.Commands.add('uploadCredential', (credential: object | string) => {
  cy.get('[data-testid="credential-upload"]').should('be.visible');

  if (typeof credential === 'object') {
    const fileObject = {
      contents: Buffer.from(JSON.stringify(credential)),
      fileName: 'credential.json', // default file name; customize if needed
      mimeType: 'application/json',
    };
    cy.get('[data-testid="credential-upload-input"]').selectFile(fileObject, { force: true });
  } else if (typeof credential === 'string') {
    // Treat the string as a file path (fixture)
    cy.get('[data-testid="credential-upload-input"]').selectFile(credential, { force: true });
  }
});

// Command to expand a validation group (defaults to 'DigitalProductPassport-group-header')
Cypress.Commands.add('expandGroup', (groupTestId: string = 'DigitalProductPassport-group-header') => {
  cy.get(`[data-testid="${groupTestId}"]`).click();
});

// Command to validate that a specific step shows the expected status icon
Cypress.Commands.add(
  'checkValidationStatus',
  (stepName: string, status: 'success' | 'failure' | 'in progress' | 'missing') => {
    cy.contains(stepName).parent().find(`[data-testid$="status-icon-${status}"]`).should('be.visible');
  },
);

// Command to open error details
Cypress.Commands.add('openErrorDetails', () => {
  cy.contains('View Details').click();
});

// Command to validate that the confetti is visible
Cypress.Commands.add('validateConfetti', () => {
  cy.get('canvas')
    .should('have.attr', 'style')
    .and('include', 'position: fixed')
    .and('include', 'pointer-events: none')
    .and('include', 'z-index: 100');
});

export {};
