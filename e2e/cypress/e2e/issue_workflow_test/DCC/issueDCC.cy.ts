import IssuePage from 'cypress/page/issuePage';

class DCCIssueFlow extends IssuePage {
  testGenerateDCCWorkflow() {
    this.generateWorkflow(
      'General features',
      'Generate DCC',
      'ConformityCredential',
      'DigitalConformityCredential_instance-v0.5.0.json',
      'generalFeatures',
    );
  }

  testUNTPTestSuite() {
    this.runUntpTest('digitalConformityCredential', 'v0.5.0');
  }
}

describe('Issue DCC end-to-end testing flow', () => {
  const dccTest = new DCCIssueFlow();

  beforeEach(() => {
    dccTest.beforeAll();
  });

  it('should access the right app config data', () => {
    dccTest.testAppConfig();
  });

  it('should generate DCC', () => {
    dccTest.testGenerateDCCWorkflow();
  });

  it('Verify linkType for DCC', () => {
    dccTest.verifyLinkType('http://localhost:3000/gs1/01/09359502000034');
  });

  it('Runs testing UNTP test suite for DCC', () => {
    dccTest.testUNTPTestSuite();
  });
});
