import IssuePage from 'cypress/page/issuePage';

class DPPIssueFlow extends IssuePage {
  testGenerateDPPWorkflow() {
    this.generateWorkflow(
      'Orchard Facility',
      'Issue DPP',
      'DigitalProductPassport',
      'DigitalProductPassport_instance-v0.5.0.json',
      'apps',
    );
  }

  testUNTPTestSuite() {
    this.runUntpTest('digitalProductPassport', 'v0.5.0');
  }
}

describe('Issue DPP end-to-end testing flow', () => {
  const dppTest = new DPPIssueFlow();

  beforeEach(() => {
    dppTest.beforeAll();
  });

  it('should access the right the app config data', () => {
    dppTest.testAppConfig();
  });

  it('should visit the homepage, navigate to "Orchard Facility", handle API calls, and show success message', () => {
    dppTest.testGenerateDPPWorkflow();
  });

  it('Verify linkType', () => {
    const checkLinkTypeURL = 'http://localhost:3000/gs1/01/09359502000034/10/6789?linkType=gs1:sustainabilityInfo';
    dppTest.verifyLinkType(checkLinkTypeURL);
  });

  it('Runs testing UNTP test suite for DPP', () => {
    dppTest.testUNTPTestSuite();
  });
});
