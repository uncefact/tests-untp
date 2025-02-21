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

// Command to open error details for a specific step
Cypress.Commands.add('openErrorDetailsByStepName', (stepName: string) => {
  cy.contains(stepName).parent().parent().contains('View Details').click();
});

// Command to validate that the confetti is visible
Cypress.Commands.add('validateConfetti', () => {
  cy.get('canvas')
    .should('have.attr', 'style')
    .and('include', 'position: fixed')
    .and('include', 'pointer-events: none')
    .and('include', 'z-index: 100');
});

// Command to check VCDM version badge color
Cypress.Commands.add('checkVCDMVersionColor', (credentialType: string, expectedColor: 'green' | 'red') => {
  const colorClasses = {
    green: ['bg-green-100', 'text-green-800'],
    red: ['bg-red-100', 'text-red-800'],
  };

  cy.get(`[data-testid="${credentialType}-vcdm-version"]`)
    .should('have.class', colorClasses[expectedColor][0])
    .and('have.class', colorClasses[expectedColor][1]);
});

// Command to open validation details
Cypress.Commands.add('openValidationDetails', (validationTitle: string = 'Fix validation error') => {
  cy.contains(validationTitle).click();
});

// Command to check the error messages displayed on the validation errors tab
Cypress.Commands.add('checkValidationErrorMessages', (errorMessages: string[]) => {
  errorMessages.forEach((message) => {
    cy.contains(message).should('be.visible');
  });
});
