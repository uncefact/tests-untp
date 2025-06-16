interface PlaygroundChainable {
  /**
   * Uploads a credential file.
   * Accepts either an object (which will be stringified) or a path to a fixture file.
   */
  uploadCredential(credential: object | string): Cypress.Chainable<void>;

  /**
   * Expands a validation group. Defaults to the DigitalProductPassport group.
   */
  expandGroup(groupTestId?: string): Cypress.Chainable<void>;

  /**
   * Checks that the validation status icon for a given step is visible.
   * The status can be either 'success', 'failure', 'in progress', or 'missing'.
   */
  checkValidationStatus(
    stepName: string,
    status: 'success' | 'failure' | 'in progress' | 'missing',
  ): Cypress.Chainable<void>;

  /**
   * Opens the error details draw.
   */
  openErrorDetails(): Cypress.Chainable<void>;

  /**
   * Opens the error details for a specific step.
   */
  openErrorDetailsByStepName(stepName: string): Cypress.Chainable<void>;

  /**
   * Validates that the confetti is visible.
   */
  validateConfetti(): Cypress.Chainable<void>;

  /**
   * Checks the color of the VCDM version badge.
   */
  checkVCDMVersionColor(credentialType: string, expectedColor: 'green' | 'red'): Cypress.Chainable<void>;

  /**
   * Opens the validation details.
   */
  openValidationDetails(validationTitle: string): Cypress.Chainable<void>;

  /**
   * Checks the error messages displayed on validation errors tab.
   */
  checkValidationErrorMessages(errorMessages: string[]): Cypress.Chainable<void>;

  /* Performs all steps for a successful validation
   */
  performSuccessfulValidation(): Cypress.Chainable<void>;

  /**
   * Generates a report with the given implementation name
   */
  generateReport(implementationName: string): Cypress.Chainable<void>;

  /**
   * Downloads and verifies the basic structure of a report
   */
  downloadAndVerifyReport(implementationName: string, expectedPass: boolean, format?: string): Cypress.Chainable<any>;
}

interface IssueChainable {
  verifyAppConfig(): Cypress.Chainable<void>;
  generateWorkflow(
    page: string,
    workflowName: string,
    schemaName: string,
    configPath: string,
    successMessage?: string,
  ): Cypress.Chainable<void>;
  runUntpTest(type: string, version: string, testData: any, expectResult?: string): Cypress.Chainable<void>;
}

declare namespace Cypress {
  interface Chainable<Subject = any> extends IssueChainable, PlaygroundChainable {
    loadAppConfig(): Chainable<Record<string, any>>;
    navigateTo(page: string): Chainable<void>;
    interceptAPI(method: string, url: string, alias: string): Chainable<void>;
    waitForAPIResponse(alias: string, expectedStatus: number): Chainable<void>;
    verifySuccessToast(successMessage: string): Chainable<JQuery<HTMLElement>>;
    writeToFile(fileName: string, data: any): Chainable<void>;
    verifyLinkType(url: string): Chainable<any>;
    verifyFileDownload(buttonName: string, filePath: string): Chainable<any>;
  }
}
