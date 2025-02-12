class IssuePage {
  constructor() {}

  beforeAll() {
    cy.loadAppConfig();
    Cypress.env('lastCredential', undefined);
    Cypress.env('uniqueQualifierPath', undefined);
    cy.task('resetData');
  }

  testAppConfig() {
    cy.verifyAppConfig();
  }

  // General method to generate workflow. Parameters can be overridden in child classes
  generateWorkflow(
    featureCategory: string,
    featureName: string,
    credentialType: string,
    featurePath: string,
  ): void {
    cy.generateWorkflow(featureCategory, featureName, credentialType, featurePath);
  }

  // General method to verify link type. URL can be passed dynamically
  verifyLinkType(url: string): void {
    cy.verifyLinkType(url);
  }

  runUntpTest(type: string, version: string, testData?: any, expectResult?: string): void {
    const credential = Cypress.env('lastCredential');
    const updatedTestData = { ...testData, ...credential };
    cy.runUntpTest(type, version, updatedTestData, expectResult);
  }
}

export default IssuePage;
