describe('Issue DCC end-to-end testing flow', () => {
  beforeEach(() => {
    // Load app config JSON
    cy.loadAppConfig();
  });

  it('should access the right app config data', () => {
    cy.verifyAppConfig();
  });

  it('should visit the homepage, navigate to "Generate DCC" through "General features", handle API calls, and show success message', () => {
    cy.generateWorkflow(
      'General features',
      'Generate DCC',
      'getConformityCredential',
      'DigitalConformityCredential_instance-v0.5.0.json',
      'generalFeatures',
    );
  });

  it('Verify linkType', () => {
    const checkLinkTypeURL = 'http://localhost:3000/gs1/01/09359502000034';
    cy.verifyLinkType(checkLinkTypeURL);
  });

  it('Runs testing UNTP V0.5.0', () => {
    cy.runShellScript('./cypress/e2e/issue_workflow_test/DCC/test-untp-dcc-scripts.sh').then((output: any) => {
      const cleanedOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
      cy.log('Shell Script Output:', cleanedOutput);
      expect(cleanedOutput).to.include('Script completed successfully!');
      expect(cleanedOutput).to.include('Testing Credential: digitalConformityCredential');
      expect(cleanedOutput).to.include('Result: PASS');
    });

    cy.deleteFile('DigitalConformityCredential_instance-v0.5.0.json').then((result) => {
      if (result) {
        cy.log('File deleted successfully');
      } else {
        cy.log('File not found or could not be deleted');
      }
    });
  });
});
