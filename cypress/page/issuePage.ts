class IssuePage {
  constructor() {}

  beforeAll() {
    cy.loadAppConfig();
  }

  testAppConfig() {
    cy.verifyAppConfig();
  }

  // General method to generate workflow. Parameters can be overridden in child classes
  generateWorkflow(
    featureCategory: string,
    featureName: string,
    credentialType: string,
    instanceFile: string,
    featurePath: string,
  ): void {
    cy.generateWorkflow(featureCategory, featureName, credentialType, instanceFile, featurePath);
  }

  // General method to verify link type. URL can be passed dynamically
  verifyLinkType(url: string): void {
    cy.verifyLinkType(url);
  }

  // Method to log the current directory
  logCurrentDir() {
    cy.exec('pwd').then((result) => {
      cy.log('Current directory:', result.stdout);
    });
  }

  // General method to run shell scripts, can be extended for different scripts
  runShellScript(scriptPath: string): void {
    cy.task('runShellScript', { scriptPath }).then((output) => {
      const cleanedOutput = (output as string).replace(/\x1b\[[0-9;]*m/g, '');
      cy.log('Shell Script Output:', cleanedOutput);
      expect(cleanedOutput).to.include('Script completed successfully!');
    });
  }

  // General method to delete files after tests, can be specific to the credential type
  deleteFile(filePath: string) {
    cy.task('deleteFileCredentialE2E', filePath).then((result) => {
      if (result) {
        cy.log('File deleted successfully');
      } else {
        cy.log('File not found or could not be deleted');
      }
    });
  }
}

export default IssuePage;
