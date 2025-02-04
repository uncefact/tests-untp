// import { LinkType } from 'packages/services/src';

describe('Issue DPP end-to-end testing flow', () => {
  beforeEach(() => {
    // Load app config JSON
    cy.loadAppConfig();
  });

  it('should access the right the app config data', () => {
    cy.verifyAppConfig();
  });

  it('should visit the homepage, navigate to "Orchard Facility", handle API calls, and show success message', () => {
    cy.generateWorkflow(
      'Orchard Facility',
      'Issue DPP',
      'DigitalProductPassport',
      'DigitalProductPassport_instance-v0.5.0.json',
      'apps',
    );
  });

  it('Verify linkType', () => {
    const checkLinkTypeURL = 'http://localhost:3000/gs1/01/09359502000034/10/6789?linkType=gs1:sustainabilityInfo';
    cy.verifyLinkType(checkLinkTypeURL);
  });

  it('Runs testing UNTP V0.5.0', () => {
    cy.exec('pwd').then((result) => {
      cy.log('Current directory:', result.stdout);
    });
    cy.task('runShellScript', { scriptPath: './cypress/e2e/issue_workflow_test/DPP/test-untp-dpp-scripts.sh' }).then(
      (output: any) => {
        const cleanedOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
        cy.log('Shell Script Output:', cleanedOutput);
        // Expect the output to include success message
        expect(cleanedOutput).to.include('Script completed successfully!');
        expect(cleanedOutput).to.include('Testing Credential: digitalProductPassport');
        expect(cleanedOutput).to.include('Result: PASS');
      },
    );

    // Define the path to the JSON file you want to delete
    const filePath = 'DigitalProductPassport_instance-v0.5.0.json';

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
