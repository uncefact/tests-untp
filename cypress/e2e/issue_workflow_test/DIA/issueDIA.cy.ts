describe('Issue DIA end-to-end testing flow', () => {
  beforeEach(() => {
    // Load app config JSON
    cy.loadAppConfig();
  });

  it('should access the right app config data', () => {
    cy.verifyAppConfig();
  });

  it('should visit the homepage, navigate to "Generate DIA" thought "General features", handle API calls, and show success message', () => {
    cy.generateWorkflow(
      'General features',
      'Generate DIA',
      'DigitalIdentityAnchor',
      'DigitalIdentityAnchor_instance-v0.2.1.json',
      'generalFeatures',
    );
  });

  it('Verify linkType', () => {
    const checkLinkTypeURL = 'http://localhost:3000/gs1/01/09359502000010';
    cy.verifyLinkType(checkLinkTypeURL);
  });

  it('Runs testing UNTP V0.2.1', () => {
    cy.exec('pwd').then((result) => {
      cy.log('Current directory:', result.stdout);
    });
    cy.task('runShellScript', { scriptPath: './cypress/e2e/issue_workflow_test/DIA/test-untp-dia-scripts.sh' }).then(
      (output: any) => {
        const cleanedOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
        cy.log('Shell Script Output:', cleanedOutput);
        // Expect the output to include success message
        expect(cleanedOutput).to.include('Script completed successfully!');
        expect(cleanedOutput).to.include('Testing Credential: digitalIdentityAnchor');
        // render method warning
        expect(cleanedOutput).to.include('Result: WARN');
      },
    );

    // Define the path to the JSON file you want to delete
    const filePath = 'DigitalIdentityAnchor_instance-v0.2.1.json';

    // Call the task to delete the file
    cy.task('deleteFileCredentialE2E', filePath).then((result) => {
      if (result) {
        cy.log('File deleted successfully');
      } else {
        cy.log('File not found or could not be deleted');
      }
    });
  });
});
